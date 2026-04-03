export const renderHighlight = async (page, box, text) => {
    await page.evaluate(([targetBox, labelText]) => {
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
        label.style.top = `${targetBox.y - 30}px`;
        label.style.backgroundColor = "red";
        label.style.color = "white";
        label.style.padding = "4px 8px";
        label.style.fontSize = "14px";
        label.style.fontWeight = "bold";
        label.style.borderRadius = "4px";
        label.style.pointerEvents = "none";
        label.style.zIndex = "999999";
        label.innerText = `⬇ ${labelText}`;
        document.body.appendChild(highlight);
        document.body.appendChild(label);
    }, [box, text]);
};
export const clearHighlight = async (page) => {
    await page.evaluate(() => {
        document.getElementById("trae-highlight-box")?.remove();
        document.getElementById("trae-highlight-label")?.remove();
    });
};
