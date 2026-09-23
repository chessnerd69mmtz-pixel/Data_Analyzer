import "./styles/reset.css";
import "./styles/app.css";
import "./styles/forms.css";
import "./styles/tables.css";
import "./styles/warnings.css";
import { App } from "./app/App.ts";

const root = document.querySelector<HTMLElement>("#app");
if (!root) throw new Error("Application root not found.");
new App(root);
