import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./app/App";
import { ThemeProvider } from "./app/providers/ThemeProvider";
import { DashboardDataProvider } from "./app/providers/DashboardDataProvider";
import "./styles/tokens.css";
import "./styles/themes.css";
import "./styles/globals.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <DashboardDataProvider>
          <App />
        </DashboardDataProvider>
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
