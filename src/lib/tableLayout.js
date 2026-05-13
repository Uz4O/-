export const tableLayout = {
  tableX: 0.205,
  tableY: 0.145,
  groupWidth: 0.186,
  numberColumnWidth: 0.039,
  rowHeight: 0.067,
  paddingX: 0.012,
  paddingY: 0.014,
  sourceWidthPaddingMultiplier: 2.5,
  sourceHeightPaddingMultiplier: 1.6,
};

export function getAmountCellRect(width, height, number, layout = tableLayout) {
  const value = Number(number);
  const groupIndex = Math.min(3, Math.floor((value - 1) / 12));
  const rowIndex = groupIndex === 3 ? value - 37 : (value - 1) % 12;

  const tableX = width * layout.tableX;
  const tableY = height * layout.tableY;
  const groupWidth = width * layout.groupWidth;
  const numberColumnWidth = width * layout.numberColumnWidth;
  const rowHeight = height * layout.rowHeight;
  const paddingX = width * layout.paddingX;
  const paddingY = height * layout.paddingY;
  const sourceX = tableX + groupIndex * groupWidth + numberColumnWidth + paddingX;
  const sourceY = tableY + rowIndex * rowHeight + paddingY;
  const sourceWidth =
    groupWidth - numberColumnWidth - paddingX * layout.sourceWidthPaddingMultiplier;
  const sourceHeight = rowHeight - paddingY * layout.sourceHeightPaddingMultiplier;

  return {
    x: sourceX,
    y: sourceY,
    width: sourceWidth,
    height: sourceHeight,
  };
}
