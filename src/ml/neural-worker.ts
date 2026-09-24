import * as tf from "@tensorflow/tfjs";

interface FeatureColumn {
  name: string;
  index: number;
}

interface NeuralPayload {
  targetColumn: { name: string; index: number };
  targetType: "number" | "classification";
  featureColumns: FeatureColumn[];
  rows: unknown[][];
}

interface NeuralResult {
  modelType: string;
  task: "regression" | "classification";
  score: number;
  scoreLabel: string;
  featureImportance: Record<string, number>;
  notes: string[];
}

interface WorkerResponse {
  ok: boolean;
  result?: NeuralResult;
  reason?: string;
}

type NumericMatrix = number[][];

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function normalizeRows(rows: NumericMatrix, means: number[], stds: number[]): NumericMatrix {
  return rows.map((row) =>
    row.map((value, index) => (value - means[index]) / (stds[index] || 1))
  );
}

function tensorToNumbers(prediction: tf.Tensor | tf.Tensor[]): number[] {
  const tensor = Array.isArray(prediction) ? prediction[0] : prediction;
  const values = tensor.dataSync();
  const output = Array.from(values, (value) => Number(value));
  tensor.dispose();
  return output;
}

function regressionR2(actual: number[], predicted: number[]): number {
  if (actual.length === 0 || actual.length !== predicted.length) return 0;
  const mean = actual.reduce((sum, value) => sum + value, 0) / actual.length;
  const total = actual.reduce((sum, value) => sum + (value - mean) ** 2, 0);
  if (total === 0) return 0;
  const residual = actual.reduce(
    (sum, value, index) => sum + (value - predicted[index]) ** 2,
    0
  );
  return 1 - residual / total;
}

function classificationAccuracy(actual: number[], predicted: number[]): number {
  if (actual.length === 0 || actual.length !== predicted.length) return 0;
  const correct = predicted.reduce(
    (sum, value, index) => sum + (value === actual[index] ? 1 : 0),
    0
  );
  return correct / actual.length;
}

function deterministicShuffleIndices(length: number): number[] {
  const indices = Array.from({ length }, (_, index) => index);
  for (let i = indices.length - 1; i > 0; i -= 1) {
    const j = (i * 37) % (i + 1);
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices;
}

async function trainRegression(
  trainX: NumericMatrix,
  testX: NumericMatrix,
  trainY: number[],
  testY: number[],
  means: number[],
  stds: number[],
  featureColumns: FeatureColumn[]
): Promise<NeuralResult> {
  const targetMean = trainY.reduce((sum, value) => sum + value, 0) / trainY.length;
  const targetStd =
    Math.sqrt(
      trainY.reduce((sum, value) => sum + (value - targetMean) ** 2, 0) /
        Math.max(1, trainY.length - 1)
    ) || 1;

  const normalizedY = trainY.map((value) => [(value - targetMean) / targetStd]);

  const model = tf.sequential();
  model.add(
    tf.layers.dense({
      units: 32,
      activation: "relu",
      inputShape: [featureColumns.length]
    })
  );
  model.add(tf.layers.dropout({ rate: 0.1 }));
  model.add(tf.layers.dense({ units: 16, activation: "relu" }));
  model.add(tf.layers.dense({ units: 1 }));
  model.compile({ optimizer: tf.train.adam(0.01), loss: "meanSquaredError" });

  const xTrain = tf.tensor2d(normalizeRows(trainX, means, stds));
  const yTrain = tf.tensor2d(normalizedY);
  await model.fit(xTrain, yTrain, {
    epochs: 30,
    batchSize: Math.min(64, trainX.length),
    verbose: 0,
    shuffle: true
  });
  xTrain.dispose();
  yTrain.dispose();

  const xTest = tf.tensor2d(normalizeRows(testX, means, stds));
  const predictionsScaled = tensorToNumbers(model.predict(xTest));
  xTest.dispose();

  const predictions = predictionsScaled.map(
    (value) => value * targetStd + targetMean
  );
  const score = regressionR2(testY, predictions);
  const featureImportance: Record<string, number> = {};

  for (let column = 0; column < featureColumns.length; column += 1) {
    const permutation = deterministicShuffleIndices(testX.length);
    const permuted = testX.map((row) => row.slice());
    for (let rowIndex = 0; rowIndex < permuted.length; rowIndex += 1) {
      permuted[rowIndex][column] = testX[permutation[rowIndex]][column];
    }

    const tensor = tf.tensor2d(normalizeRows(permuted, means, stds));
    const shuffledScaled = tensorToNumbers(model.predict(tensor));
    tensor.dispose();

    const shuffledPredictions = shuffledScaled.map(
      (value) => value * targetStd + targetMean
    );
    const shuffledScore = regressionR2(testY, shuffledPredictions);
    featureImportance[featureColumns[column].name] = Math.max(
      0,
      score - shuffledScore
    );
  }

  const totalImportance =
    Object.values(featureImportance).reduce((sum, value) => sum + value, 0) || 1;
  for (const name of Object.keys(featureImportance)) {
    featureImportance[name] /= totalImportance;
  }

  model.dispose();

  return {
    modelType: "TensorFlow.js MLP",
    task: "regression",
    score,
    scoreLabel: "holdout R²",
    featureImportance,
    notes: [
      "Small local neural network trained entirely in the browser.",
      "Feature importance is permutation-based sensitivity, not causal importance.",
      "Use neural evidence as supporting predictive evidence rather than proof of causation."
    ]
  };
}

async function trainClassification(
  trainX: NumericMatrix,
  testX: NumericMatrix,
  trainY: number[],
  testY: number[],
  means: number[],
  stds: number[],
  featureColumns: FeatureColumn[]
): Promise<NeuralResult> {
  const model = tf.sequential();
  model.add(
    tf.layers.dense({
      units: 32,
      activation: "relu",
      inputShape: [featureColumns.length]
    })
  );
  model.add(tf.layers.dropout({ rate: 0.1 }));
  model.add(tf.layers.dense({ units: 16, activation: "relu" }));
  model.add(tf.layers.dense({ units: 1, activation: "sigmoid" }));
  model.compile({ optimizer: tf.train.adam(0.01), loss: "binaryCrossentropy" });

  const xTrain = tf.tensor2d(normalizeRows(trainX, means, stds));
  const yTrain = tf.tensor2d(trainY.map((value) => [value]));
  await model.fit(xTrain, yTrain, {
    epochs: 30,
    batchSize: Math.min(64, trainX.length),
    verbose: 0,
    shuffle: true
  });
  xTrain.dispose();
  yTrain.dispose();

  const xTest = tf.tensor2d(normalizeRows(testX, means, stds));
  const probabilities = tensorToNumbers(model.predict(xTest));
  xTest.dispose();

  const predictions = probabilities.map((value) => (value >= 0.5 ? 1 : 0));
  const score = classificationAccuracy(testY, predictions);
  const featureImportance: Record<string, number> = {};

  for (let column = 0; column < featureColumns.length; column += 1) {
    const permutation = deterministicShuffleIndices(testX.length);
    const permuted = testX.map((row) => row.slice());
    for (let rowIndex = 0; rowIndex < permuted.length; rowIndex += 1) {
      permuted[rowIndex][column] = testX[permutation[rowIndex]][column];
    }

    const tensor = tf.tensor2d(normalizeRows(permuted, means, stds));
    const shuffledProbabilities = tensorToNumbers(model.predict(tensor));
    tensor.dispose();

    const shuffledPredictions = shuffledProbabilities.map((value) =>
      value >= 0.5 ? 1 : 0
    );
    const shuffledScore = classificationAccuracy(
      testY,
      shuffledPredictions
    );
    featureImportance[featureColumns[column].name] = Math.max(
      0,
      score - shuffledScore
    );
  }

  const totalImportance =
    Object.values(featureImportance).reduce((sum, value) => sum + value, 0) || 1;
  for (const name of Object.keys(featureImportance)) {
    featureImportance[name] /= totalImportance;
  }

  model.dispose();

  return {
    modelType: "TensorFlow.js MLP",
    task: "classification",
    score,
    scoreLabel: "holdout accuracy",
    featureImportance,
    notes: [
      "Small local neural network trained entirely in the browser.",
      "Binary classification only in this lightweight neural evidence path.",
      "Feature importance is permutation-based sensitivity, not causal importance."
    ]
  };
}

async function run(payload: NeuralPayload): Promise<WorkerResponse> {
  const featureColumns = payload.featureColumns;
  if (featureColumns.length === 0) {
    return { ok: false, reason: "No numeric features were supplied." };
  }

  const usableRows = payload.rows.filter((row) =>
    featureColumns.every((column) =>
      Number.isFinite(toNumber(row[column.index]))
    )
  );

  const completeRows = usableRows.filter((row) => {
    const target = row[payload.targetColumn.index];
    return (
      payload.targetType === "number" ||
      (target !== null &&
        target !== undefined &&
        String(target).trim() !== "")
    );
  });

  if (completeRows.length < 100) {
    return {
      ok: false,
      reason: "TensorFlow neural evidence requires at least 100 complete rows."
    };
  }

  const matrix: NumericMatrix = completeRows.map((row) =>
    featureColumns.map((column) => toNumber(row[column.index]))
  );

  const split = Math.max(20, Math.floor(matrix.length * 0.2));
  if (matrix.length - split < 10 || split < 10) {
    return { ok: false, reason: "Not enough data for a stable train/test split." };
  }

  const trainX = matrix.slice(0, matrix.length - split);
  const testX = matrix.slice(matrix.length - split);

  const means = featureColumns.map(
    (_, column) =>
      trainX.reduce((sum, row) => sum + row[column], 0) / trainX.length
  );
  const stds = featureColumns.map(
    (_, column) =>
      Math.sqrt(
        trainX.reduce(
          (sum, row) => sum + (row[column] - means[column]) ** 2,
          0
        ) / Math.max(1, trainX.length - 1)
      ) || 1
  );

  if (payload.targetType === "number") {
    const targets = completeRows.map((row) =>
      toNumber(row[payload.targetColumn.index])
    );
    if (targets.some((value) => !Number.isFinite(value))) {
      return {
        ok: false,
        reason: "The numeric target contains unsupported values."
      };
    }

    const trainY = targets.slice(0, targets.length - split);
    const testY = targets.slice(targets.length - split);

    return {
      ok: true,
      result: await trainRegression(
        trainX,
        testX,
        trainY,
        testY,
        means,
        stds,
        featureColumns
      )
    };
  }

  const labels = Array.from(
    new Set(completeRows.map((row) => String(row[payload.targetColumn.index])))
  );

  if (labels.length !== 2) {
    return {
      ok: false,
      reason: "The neural evidence path currently supports binary classification only."
    };
  }

  const encoded = completeRows.map((row) =>
    String(row[payload.targetColumn.index]) === labels[1] ? 1 : 0
  );
  const trainY = encoded.slice(0, encoded.length - split);
  const testY = encoded.slice(encoded.length - split);

  return {
    ok: true,
    result: await trainClassification(
      trainX,
      testX,
      trainY,
      testY,
      means,
      stds,
      featureColumns
    )
  };
}

self.onmessage = async (event: MessageEvent<NeuralPayload>) => {
  try {
    self.postMessage(await run(event.data));
  } catch (error) {
    const response: WorkerResponse = {
      ok: false,
      reason: error instanceof Error ? error.message : String(error)
    };
    self.postMessage(response);
  }
};
