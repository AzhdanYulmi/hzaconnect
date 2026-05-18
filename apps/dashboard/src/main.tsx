import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "./i18n/index.js"; // initialize i18next before any component renders
import "./styles.css";

const el = document.getElementById("root");
if (!el) throw new Error("root element missing");
createRoot(el).render(<App />);
