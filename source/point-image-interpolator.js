// Class to interpolate point values to an image from inverse square proportional contributions
export class PointImageInterpolator {
  constructor(element) {
    this.element = element;
    this.canvas = null;
    this.imageData = null;
    this.blobUrl = null;

    // Find/create defs element for svg
    const svgNS = this.element.namespaceURI;
    const svg = this.element.closest("svg");
    let defs = svg.querySelector("defs");
    if (!defs) {
      defs = document.createElementNS(svgNS, "defs");
      svg.appendChild(defs);
    }

    // Create pattern element
    this.pattern = document.createElementNS(svgNS, "pattern");
    const patternId = "pattern-" + Math.random().toString(36).substring(2);
    this.pattern.setAttribute("id", patternId);
    this.pattern.setAttribute("patternUnits", "objectBoundingBox");
    this.pattern.setAttribute("width", "100%");
    this.pattern.setAttribute("height", "100%");
    defs.appendChild(this.pattern);

    // Add image element to pattern
    this.image = document.createElementNS(svgNS, "image");
    this.image.setAttribute("href", "");
    this.pattern.appendChild(this.image);

    this.element.setAttribute("fill", `url(#${patternId})`);

    this.resize();
  }

  interpolate(x, y, points) {
    let sum = 0;
    let totalWeight = 0;
    for (const point of points) {
      // Ignore points with no value
      if (point.value === null) continue;
      const dx = x - point.x;
      const dy = y - point.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const weight = 1 / (distance < 0.0001 ? 0.0001 : distance);
      sum += point.value * weight;
      totalWeight += weight;
    }
    if (!totalWeight) return null;
    return sum / totalWeight;
  }

  // Resizes the image to match the element size (if required)
  resize() {
    // Determine bounding for rendered element - use this to size the background image
    const boundingClient = this.element.getBoundingClientRect();
    const width = Math.floor(boundingClient.width);
    const height = Math.floor(boundingClient.height);

    // If needed, recreate image data in screen pixels
    if (
      this.imageData == null ||
      this.imageData.width != width ||
      this.imageData.height != height
    ) {
      this.imageData = new ImageData(width, height);
      this.pattern.setAttribute("viewBox", `0 0 ${width} ${height}`);
      this.image.setAttribute("width", width);
      this.image.setAttribute("height", height);
    }
  }

  // Update the image data from the point values
  update(points, colorLookup) {
    // Update each pixel of the image
    for (let y = 0; y < this.imageData.height; y++) {
      for (let x = 0; x < this.imageData.width; x++) {
        // Transform coordinates to proportional
        const px = x / (this.imageData.width - 1);
        const py = y / (this.imageData.height - 1);

        // Interpolate value from distance squared
        let value = this.interpolate(px, py, points);

        // Unknown values treated as zero
        if (value === null) value = 0;

        // Find nearest cached gradient color
        const index = Math.min(
          Math.max(
            Math.floor(
              ((value - colorLookup.min) /
                (colorLookup.max - colorLookup.min)) *
                (colorLookup.colors.length - 1),
            ),
            0,
          ),
          colorLookup.colors.length - 1,
        );
        const color = colorLookup.colors[index];

        // RGB image bytes
        const ofs = (y * this.imageData.width + x) * 4;
        this.imageData.data[ofs + 0] = (color >> 16) & 0xff;
        this.imageData.data[ofs + 1] = (color >> 8) & 0xff;
        this.imageData.data[ofs + 2] = color & 0xff;
        this.imageData.data[ofs + 3] = 0xff;
      }
    }
  }

  // Update the pattern image from the image data
  async draw() {
    if (this.imageData == null) return;
    if (
      !this.canvas ||
      this.canvas.width !== this.imageData.width ||
      this.canvas.height !== this.imageData.height
    ) {
      this.canvas = document.createElement("canvas");
      this.canvas.width = this.imageData.width;
      this.canvas.height = this.imageData.height;
    }
    const ctx = this.canvas.getContext("2d");
    ctx.putImageData(this.imageData, 0, 0);
    const blob = await new Promise((resolve) => this.canvas.toBlob(resolve));
    if (this.blobUrl) URL.revokeObjectURL(this.blobUrl);
    this.blobUrl = URL.createObjectURL(blob);
    this.image.setAttribute("href", this.blobUrl);
  }

  // Find sibling points within same group as element - coordinates as proportion along element
  static extractGroupSiblingPoints(element, siblingSelector = "circle") {
    const points = [];
    const boundingClient = element.getBoundingClientRect();
    const group = element.closest("g");
    if (group) {
      const pointElements = group.querySelectorAll(siblingSelector);
      for (const child of pointElements) {
        // Calculate location as proportion along element in screen space
        const boundingChild = child.getBoundingClientRect();
        const x =
          (boundingChild.x + boundingChild.width / 2 - boundingClient.x) /
          boundingClient.width;
        const y =
          (boundingChild.y + boundingChild.height / 2 - boundingClient.y) /
          boundingClient.height;
        points.push({ x, y, value: null, element: child });
      }
    }
    return points;
  }
}

// Also make the default
export default PointImageInterpolator;
