import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "@fontsource-variable/fraunces/full.css";      // bundled fonts (no font service is contacted)
import "@fontsource/atkinson-hyperlegible/latin-400.css";
import "@fontsource/atkinson-hyperlegible/latin-700.css";
import "./styles.css";
import "./brand.css";                                   // the OwlAccess look, loaded last
createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
