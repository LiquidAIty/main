import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@data-formulator": path.resolve(process.cwd(), "data-formulator-main/src"),
      "@reduxjs/toolkit": path.resolve(process.cwd(), "client/node_modules/@reduxjs/toolkit"),
      "react-redux": path.resolve(process.cwd(), "client/node_modules/react-redux"),
      "redux-persist": path.resolve(process.cwd(), "client/node_modules/redux-persist"),
      "redux-persist/integration/react": path.resolve(
        process.cwd(),
        "client/node_modules/redux-persist/integration/react",
      ),
      "redux": path.resolve(process.cwd(), "client/node_modules/redux"),
      "localforage": path.resolve(process.cwd(), "client/node_modules/localforage"),
      "@mui/material": path.resolve(process.cwd(), "client/node_modules/@mui/material"),
      "@mui/icons-material": path.resolve(
        process.cwd(),
        "client/node_modules/@mui/icons-material",
      ),
      "@mui/lab": path.resolve(process.cwd(), "client/node_modules/@mui/lab"),
      "@emotion/react": path.resolve(process.cwd(), "client/node_modules/@emotion/react"),
      "@emotion/styled": path.resolve(process.cwd(), "client/node_modules/@emotion/styled"),
      "react-router-dom": path.resolve(process.cwd(), "client/node_modules/react-router-dom"),
      "allotment": path.resolve(process.cwd(), "client/node_modules/allotment"),
      "react-dnd": path.resolve(process.cwd(), "client/node_modules/react-dnd"),
      "react-dnd-html5-backend": path.resolve(
        process.cwd(),
        "client/node_modules/react-dnd-html5-backend",
      ),
      "react-virtuoso": path.resolve(process.cwd(), "client/node_modules/react-virtuoso"),
      "react-simple-code-editor": path.resolve(
        process.cwd(),
        "client/node_modules/react-simple-code-editor",
      ),
      "prism-react-renderer": path.resolve(
        process.cwd(),
        "client/node_modules/prism-react-renderer",
      ),
      "prismjs": path.resolve(process.cwd(), "client/node_modules/prismjs"),
      "html2canvas": path.resolve(process.cwd(), "client/node_modules/html2canvas"),
      "exceljs": path.resolve(process.cwd(), "client/node_modules/exceljs"),
      "dompurify": path.resolve(process.cwd(), "client/node_modules/dompurify"),
      "validator": path.resolve(process.cwd(), "client/node_modules/validator"),
      "lodash": path.resolve(process.cwd(), "client/node_modules/lodash"),
      // npm hoists d3 to the root node_modules (client/node_modules/d3 no longer
      // exists), so the vitest alias must point at the hoisted copy.
      "d3": path.resolve(process.cwd(), "node_modules/d3"),
      "echarts": path.resolve(process.cwd(), "client/node_modules/echarts"),
      "react-vega": path.resolve(process.cwd(), "client/node_modules/react-vega"),
      "vega": path.resolve(process.cwd(), "client/node_modules/vega"),
      "vega-lite": path.resolve(process.cwd(), "client/node_modules/vega-lite"),
      "vega-embed": path.resolve(process.cwd(), "client/node_modules/vega-embed"),
      "gofish-graphics": path.resolve(process.cwd(), "client/node_modules/gofish-graphics"),
      "mui-markdown": path.resolve(process.cwd(), "client/node_modules/mui-markdown"),
      "vm-browserify": path.resolve(process.cwd(), "client/node_modules/vm-browserify"),
      "chart.js": path.resolve(process.cwd(), "client/node_modules/chart.js"),
      "js-yaml": path.resolve(process.cwd(), "client/node_modules/js-yaml"),
      "markdown-to-jsx": path.resolve(
        process.cwd(),
        "client/node_modules/markdown-to-jsx/dist/index.js",
      ),
      "markdown-to-jsx/entities": path.resolve(
        process.cwd(),
        "client/node_modules/markdown-to-jsx/dist/entities.js",
      ),
      "react-katex": path.resolve(process.cwd(), "client/node_modules/react-katex"),
      "katex": path.resolve(process.cwd(), "client/node_modules/katex"),
      "react-animate-height": path.resolve(process.cwd(), "client/node_modules/react-animate-height"),
      "react-animate-on-change": path.resolve(
        process.cwd(),
        "client/node_modules/react-animate-on-change",
      ),
      "react-selectable-fast": path.resolve(
        process.cwd(),
        "client/node_modules/react-selectable-fast",
      ),
    },
  },
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    hmr: {
      host: "localhost",
      port: 5173,
    },
    proxy: {
      "/api": {
        target: "http://127.0.0.1:4000",
        changeOrigin: true,
      },
    },
  },
});
