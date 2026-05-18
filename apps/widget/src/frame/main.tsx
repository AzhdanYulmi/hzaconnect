import { render } from "preact";
import { Frame } from "./Frame.js";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("no root");
render(<Frame />, root);
