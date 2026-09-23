export const pearsonKnown = {
  x: [1, 2, 3, 4, 5],
  y: [2, 4, 6, 8, 10],
  expectedR: 1
};

export const welchKnown = {
  a: Array.from({ length: 30 }, () => 1),
  b: Array.from({ length: 30 }, () => 3),
  expectedDifference: -2
};
