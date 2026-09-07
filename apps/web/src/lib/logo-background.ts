/** Choose a backing without recoloring or cropping the provider's artwork. */
export function logoBackground({ data, width, height }: ImageData) {
  const corners = [0, width - 1, width * (height - 1), width * height - 1];
  const hasUniformBackground = corners.every((pixel) => {
    const offset = pixel * 4;
    return (
      (data[offset + 3] ?? 0) >= 250 &&
      [0, 1, 2].every(
        (channel) =>
          Math.abs((data[offset + channel] ?? 0) - (data[channel] ?? 0)) < 12,
      )
    );
  });

  if (hasUniformBackground) {
    return `rgb(${data[0]}, ${data[1]}, ${data[2]})`;
  }

  let luminance = 0;
  let coverage = 0;
  for (let offset = 0; offset < data.length; offset += 4) {
    const alpha = (data[offset + 3] ?? 0) / 255;
    const channels = [0, 1, 2].map((channel) => {
      const value = (data[offset + channel] ?? 0) / 255;
      return value <= 0.04045
        ? value / 12.92
        : ((value + 0.055) / 1.055) ** 2.4;
    });
    luminance +=
      ((channels[0] ?? 0) * 0.2126 +
        (channels[1] ?? 0) * 0.7152 +
        (channels[2] ?? 0) * 0.0722) *
      alpha;
    coverage += alpha;
  }

  // Pick the neutral backing with greater contrast against the visible artwork.
  const average = coverage ? luminance / coverage : 0;
  return average < 0.179 ? "#ffffff" : "#000000";
}

export function loadedLogoBackground(image: HTMLImageElement) {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 32;
    const context = canvas.getContext("2d");
    if (!context) return "#ffffff";

    context.drawImage(image, 0, 0, 32, 32);
    return logoBackground(context.getImageData(0, 0, 32, 32));
  } catch {
    // A future provider CORS change must not break the holding row.
    return "#ffffff";
  }
}
