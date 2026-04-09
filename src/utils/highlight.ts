import type { Page } from "playwright";

export type Box = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export const renderHighlight = async (page: Page, box: Box, text: string): Promise<void> => {
  await page.evaluate(
    ([targetBox, labelText]) => {
      const highlight = document.createElement("div");
      highlight.id = "trae-highlight-box";
      highlight.style.position = "absolute";
      highlight.style.left = `${targetBox.x}px`;
      highlight.style.top = `${targetBox.y}px`;
      highlight.style.width = `${targetBox.width}px`;
      highlight.style.height = `${targetBox.height}px`;
      highlight.style.border = "3px solid red";
      highlight.style.boxShadow = "0 0 10px rgba(255,0,0,0.5)";
      highlight.style.pointerEvents = "none";
      highlight.style.zIndex = "999999";

      const label = document.createElement("div");
      label.id = "trae-highlight-label";
      label.style.position = "absolute";
      label.style.left = `${targetBox.x}px`;
      label.style.top = `${Math.max(targetBox.y - 30, 4)}px`;
      label.style.backgroundColor = "red";
      label.style.color = "white";
      label.style.padding = "4px 8px";
      label.style.fontSize = "14px";
      label.style.fontWeight = "bold";
      label.style.borderRadius = "4px";
      label.style.pointerEvents = "none";
      label.style.zIndex = "999999";
      label.innerText = `STEP ${labelText}`;

      document.body.appendChild(highlight);
      document.body.appendChild(label);
    },
    [box, text] as const,
  );
};

export const renderRowHighlight = async (page: Page, box: Box, text: string): Promise<void> => {
  await page.evaluate(
    ([targetBox, labelText]) => {
      const rowHighlight = document.createElement("div");
      rowHighlight.id = "trae-row-highlight-box";
      rowHighlight.style.position = "absolute";
      rowHighlight.style.left = `${targetBox.x}px`;
      rowHighlight.style.top = `${targetBox.y}px`;
      rowHighlight.style.width = `${targetBox.width}px`;
      rowHighlight.style.height = `${targetBox.height}px`;
      rowHighlight.style.backgroundColor = "rgba(255, 140, 0, 0.18)";
      rowHighlight.style.borderLeft = "5px solid #ff6b00";
      rowHighlight.style.borderTop = "2px solid #ff6b00";
      rowHighlight.style.borderBottom = "2px solid #ff6b00";
      rowHighlight.style.borderRight = "2px solid #ff8c33";
      rowHighlight.style.boxShadow =
        "0 4px 16px rgba(255, 107, 0, 0.25), inset 0 0 20px rgba(255, 107, 0, 0.08)";
      rowHighlight.style.pointerEvents = "none";
      rowHighlight.style.zIndex = "999998";
      rowHighlight.style.borderRadius = "6px";

      const label = document.createElement("div");
      label.id = "trae-row-highlight-label";
      label.style.position = "absolute";
      label.style.left = `${Math.max(targetBox.x + 4, 4)}px`;
      label.style.top = `${Math.max(targetBox.y - 28, 4)}px`;
      label.style.backgroundColor = "#ff6b00";
      label.style.color = "white";
      label.style.padding = "3px 10px";
      label.style.fontSize = "13px";
      label.style.fontWeight = "bold";
      label.style.borderRadius = "12px";
      label.style.pointerEvents = "none";
      label.style.zIndex = "999999";
      label.style.boxShadow = "0 2px 8px rgba(255, 107, 0, 0.4)";
      label.innerText = `VERIFY ${labelText}`;

      document.body.appendChild(rowHighlight);
      document.body.appendChild(label);
    },
    [box, text] as const,
  );
};

export const clearHighlight = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    document.getElementById("trae-highlight-box")?.remove();
    document.getElementById("trae-highlight-label")?.remove();
    document.getElementById("trae-row-highlight-box")?.remove();
    document.getElementById("trae-row-highlight-label")?.remove();
  });
};
