// Interpolate a list of stops [{offset, color}, ...], with strictly ascending offset, for the specified value.
export class ColorInterpolator {
  constructor(stops) {
    if (!Array.isArray(stops) || !stops.length)
      throw new Error("stops must be an array with at least one element");
    this.stops = stops;
  }

  interpolateColor(value) {
    // Begin with first/last values to saturate if outside range
    let before = this.stops[0],
      after = this.stops[this.stops.length - 1];

    // Find neighbouring stops (could use binary search as they are ordered)
    for (const stop of this.stops) {
      if (stop.offset <= value) {
        before = stop;
      }
      if (stop.offset > value) {
        after = stop;
        break;
      }
    }

    // Translate color
    const beforeColor = ColorInterpolator.toRGB(before.color);
    const afterColor = ColorInterpolator.toRGB(after.color);

    // Linearly interpolate between adjacent stops.  Clamp range incase value is outside stop range.
    const proportion = Math.max(
      Math.min(
        (value - before.offset) /
          (after.offset - before.offset > 0 ? after.offset - before.offset : 1),
        1
      ),
      0
    );
    return {
      r: Math.round(
        (afterColor.r - beforeColor.r) * proportion + beforeColor.r
      ),
      g: Math.round(
        (afterColor.g - beforeColor.g) * proportion + beforeColor.g
      ),
      b: Math.round(
        (afterColor.b - beforeColor.b) * proportion + beforeColor.b
      ),
    };
  }

  // Accepts 0xRRGGBB / '#RRGGBB' / [r, g, b] / {r, g, b}; returns 0xRRGGBB.
  static toNumeric(color) {
    if (
      typeof color === "string" &&
      color.startsWith("#") &&
      color.length === 7
    ) {
      return parseInt(color.substring(1), 16);
    } else if (Array.isArray(color)) {
      return (color[0] << 16) | (color[1] << 8) | color[2];
    } else if (
      typeof color === "object" &&
      "r" in color &&
      "g" in color &&
      "b" in color
    ) {
      return (color.r << 16) | (color.g << 8) | color.b;
    }
    return color;
  }

  // Accepts 0xRRGGBB / '#RRGGBB' / [r, g, b] / {r, g, b}; returns '#RRGGBB'.
  static toColorString(color) {
    if (
      typeof color === "string" &&
      color.startsWith("#") &&
      color.length === 7
    )
      return color;
    const value = ColorInterpolator.toNumeric(color);
    return `#${value.toString(16).padStart(6, "0")}`;
  }

  // Accepts 0xRRGGBB / '#RRGGBB' / [r, g, b] / {r, g, b}; returns { r, g, b }.
  static toRGB(color) {
    if (
      typeof color === "object" &&
      "r" in color &&
      "g" in color &&
      "b" in color
    ) {
      return color;
    }
    const value = ColorInterpolator.toNumeric(color);
    return {
      r: (value >> 16) & 0xff,
      g: (value >> 8) & 0xff,
      b: value & 0xff,
    };
  }

  // Creates a quantized look-up table of numeric colors between the minimum and maximum stop values
  createLookup(numSteps = 1024) {
    const lookup = {
      min: this.stops[0].offset,
      max: this.stops[this.stops.length - 1].offset,
      colors: [],
    };
    for (let i = 0; i < numSteps; i++) {
      const color = this.interpolateColor(
        lookup.min + ((lookup.max - lookup.min) * i) / (numSteps - 1)
      );
      const numericColor = ColorInterpolator.toNumeric(color);
      lookup.colors.push(numericColor);
    }
    return lookup;
  }
}

// Also make the default
export default ColorInterpolator;
