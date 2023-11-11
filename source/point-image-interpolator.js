// Dan Jackson, 2023

// TODO: Add option for custom outer geometry
// TODO: Recreate (and fix) possible caching bug with null data points?
// TODO: Use single value (rather than texture coords), and do not use vertex colour.

import Voronoi from "./voronoi.js";

// Class to interpolate point values to an image from inverse square proportional contributions
export class PointImageInterpolator {
  constructor(element, options) {
    this.options = Object.assign(
      {
        mode: "voronoi",
        useDataUri: false,
        useVertexColor: false,
        subdivide: 1,
        webgl: ["webgl2", "webgl"],
      },
      options
    );
    if (typeof options.webgl == "string") options.webgl = [options.webgl];
    this.element = element;
    this.canvas = null;

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

    this.blobUrl = null;
    this.blob = null;

    this.element.setAttribute("fill", `url(#${patternId})`);

    // Dimensions of pattern
    this.width = 0;
    this.height = 0;

    // Bitmap-based image data, if used in inverse-distance (0) or nearest (1) mode
    this.imageData = null;

    // Voronoi, if used in voronoi mode
    this.voronoi = new Voronoi();
    this.boundingBox = { xl: 0, xr: this.width, yt: 0, yb: this.height };
    this.previousPoints = null;
    this.points = [];

    // GL
    this.lastColorLookup = null;
    this.texture = null;

    this.resize();
  }

  // Resizes the image to match the element size (if required)
  resize() {
    // Determine bounding for rendered element - use this to size the pattern
    const boundingClient = this.element.getBoundingClientRect();
    const width = Math.floor(boundingClient.width);
    const height = Math.floor(boundingClient.height);

    // If needed, adjust for new size
    if (this.width != width || this.height != height) {
      this.width = width;
      this.height = height;
      this.pattern.setAttribute("viewBox", `0 0 ${this.width} ${this.height}`);
      this.image.setAttribute("width", this.width);
      this.image.setAttribute("height", this.height);
    }
  }

  // (Internal)
  interpolateInverseDistance(x, y, points) {
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

  // (Internal)
  interpolateNearest(x, y, points) {
    let closestDistance = null;
    let nearest = null;
    for (const point of points) {
      // Ignore points with no value
      if (point.value === null) continue;
      const dx = x - point.x;
      const dy = y - point.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (closestDistance === null || distance < closestDistance) {
        closestDistance = distance;
        nearest = point;
      }
    }
    if (nearest === null) return null;
    return nearest.value;
  }

  // (Internal) Update per-pixel mode
  updatePerPixel(points, colorLookup) {
    // If needed, recreate the image data
    if (
      this.imageData == null ||
      this.imageData.width != this.width ||
      this.imageData.height != this.height
    ) {
      this.imageData = new ImageData(this.width, this.height);
    }

    // Update each pixel of the image
    for (let y = 0; y < this.imageData.height; y++) {
      for (let x = 0; x < this.imageData.width; x++) {
        // Transform coordinates to proportional
        const px = x / (this.imageData.width - 1);
        const py = y / (this.imageData.height - 1);

        // Interpolate value from distance
        let value = null;
        if (this.options.mode == "idf") {
          value = this.interpolateInverseDistance(px, py, points);
        } else if (this.options.mode == "nearest") {
          value = this.interpolateNearest(px, py, points);
        }

        // Unknown values treated as zero
        if (value === null) value = 0;

        // Find nearest cached gradient color
        const color = this.getColor(colorLookup, value);

        // RGB image bytes
        const ofs = (y * this.imageData.width + x) * 4;
        this.imageData.data[ofs + 0] = (color >> 16) & 0xff;
        this.imageData.data[ofs + 1] = (color >> 8) & 0xff;
        this.imageData.data[ofs + 2] = color & 0xff;
        this.imageData.data[ofs + 3] = 0xff;
      }
    }

    const ctx = this.canvas.getContext("2d");
    ctx.putImageData(this.imageData, 0, 0);
  }

  // (Internal) Subdivide edges to improve interpolation
  subdivideVoronoiDiagram(diagram) {
    const newEdges = [];
    for (const edge of diagram.edges) {
      const vm = {
        x: (edge.va.x + edge.vb.x) / 2,
        y: (edge.va.y + edge.vb.y) / 2,
      };
      edge.newEdge0 = {
        lSite: edge.lSite,
        rSite: edge.rSite,
        va: edge.va,
        vb: vm,
      };
      edge.newEdge1 = {
        lSite: edge.lSite,
        rSite: edge.rSite,
        va: vm,
        vb: edge.vb,
      };
      newEdges.push(edge.newEdge0);
      newEdges.push(edge.newEdge1);
    }
    diagram.edges = newEdges;

    // Update cell halfedges
    for (const cell of diagram.cells) {
      const newHalfedges = [];
      for (const halfedge of cell.halfedges) {
        const halfedge0 = Voronoi.prototype.createHalfedge(
          halfedge.edge.newEdge0,
          halfedge.lSite,
          halfedge.rSite
        );
        const halfedge1 = Voronoi.prototype.createHalfedge(
          halfedge.edge.newEdge1,
          halfedge.lSite,
          halfedge.rSite
        );
        newHalfedges.push(halfedge0);
        newHalfedges.push(halfedge1);
      }
      cell.halfedges = newHalfedges;
    }
  }

  // (Internal) Extend the Voronoi diagram by annotating shared edge vertices
  extendVoronoiDiagram(diagram) {
    // Eek, O(n^2), but only performed once per diagram
    for (const edge of diagram.edges) {
      edge.va.adjacentSites = [];
      edge.vb.adjacentSites = [];
      if (edge.lSite !== null) {
        edge.va.adjacentSites.push(edge.lSite);
        edge.vb.adjacentSites.push(edge.lSite);
      }
      if (edge.rSite !== null) {
        edge.va.adjacentSites.push(edge.rSite);
        edge.vb.adjacentSites.push(edge.rSite);
      }
      for (const otherEdge of diagram.edges) {
        if (edge === otherEdge) continue;
        if (
          (otherEdge.va.x == edge.va.x && otherEdge.va.y == edge.va.y) ||
          (otherEdge.vb.x == edge.va.x && otherEdge.vb.y == edge.va.y)
        ) {
          if (
            otherEdge.lSite !== null &&
            !edge.va.adjacentSites.includes(otherEdge.lSite)
          ) {
            edge.va.adjacentSites.push(otherEdge.lSite);
          }
          if (
            otherEdge.rSite !== null &&
            !edge.va.adjacentSites.includes(otherEdge.rSite)
          ) {
            edge.va.adjacentSites.push(otherEdge.rSite);
          }
        }
        if (
          (otherEdge.va.x == edge.vb.x && otherEdge.va.y == edge.vb.y) ||
          (otherEdge.vb.x == edge.vb.x && otherEdge.vb.y == edge.vb.y)
        ) {
          if (
            otherEdge.lSite !== null &&
            !edge.vb.adjacentSites.includes(otherEdge.lSite)
          ) {
            edge.vb.adjacentSites.push(otherEdge.lSite);
          }
          if (
            otherEdge.rSite !== null &&
            !edge.vb.adjacentSites.includes(otherEdge.rSite)
          ) {
            edge.vb.adjacentSites.push(otherEdge.rSite);
          }
        }
      }
    }
  }

  getColor(colorLookup, value) {
    const index = Math.min(
      Math.max(
        Math.floor(
          ((value - colorLookup.min) / (colorLookup.max - colorLookup.min)) *
            (colorLookup.colors.length - 1)
        ),
        0
      ),
      colorLookup.colors.length - 1
    );
    const color = colorLookup.colors[index];
    return color;
  }

  // (Internal) Write packed color to array
  writeColor(array, index, color) {
    array[index + 0] = ((color >> 16) & 0xff) / 255;
    array[index + 1] = ((color >> 8) & 0xff) / 255;
    array[index + 2] = (color & 0xff) / 255;
    array[index + 3] = 1;
    return 4;
  }

  // (Internal) Update Voronoi mode
  updateVoronoi(points, colorLookup) {
    // Our points references only non-null values
    this.points = points.filter((point) => point.value !== null);

    // Recalculate the Voronoi diagram, if required
    let pointsMoved = false;
    if (this.boundingBox.xr != 1 || this.boundingBox.yb != 1) {
      // this.width this.height
      pointsMoved = true;
    } else if (
      this.previousPoints == null ||
      this.previousPoints.length != this.points.length
    ) {
      pointsMoved = true;
    } else {
      // Determine if any points have changed
      for (let i = 0; i < this.previousPoints.length; i++) {
        if (
          this.previousPoints[i].index >= this.points.length ||
          this.previousPoints[i].x !=
            this.points[this.previousPoints[i].index].x ||
          this.previousPoints[i].y !=
            this.points[this.previousPoints[i].index].y
        ) {
          pointsMoved = true;
          break;
        }
      }
    }

    // HACK: Voronoi calculation fails with single point
    if (this.points.length == 1) {
      this.points.push({
        x: this.points[0].x + 0.0001,
        y: this.points[0].y + 0.0001,
        value: null,
        hack: true,
      });
    }
    if (this.points.length == 2 && this.points[1].hack) {
      this.points[1].value = this.points[0].value;
    }

    if (pointsMoved) {
      // Remember previous points as a copy of their positions and indices
      this.previousPoints = [];
      for (let i = 0; i < this.points.length; i++) {
        const point = this.points[i];
        if (point.value !== null) {
          this.previousPoints.push({ x: point.x, y: point.y, index: i });
        }
      }
      // Recalculate the Voronoi diagram
      this.boundingBox.xr = 1; // this.width;
      this.boundingBox.yb = 1; // this.height;
      this.diagram = this.voronoi.compute(this.points, this.boundingBox);
      for (let i = 0; i < this.options.subdivide; i++) {
        this.subdivideVoronoiDiagram(this.diagram);
      }
      this.extendVoronoiDiagram(this.diagram);
      console.dir(this.diagram);
    }

    // Update the image data
    if (this.gl == null) {
      // GL context
      for (const glVersion of this.options.webgl) {
        this.gl = this.canvas.getContext(glVersion);
        if (this.gl) {
          this.glVersion = glVersion;
          break;
        }
        console.log("WARNING: Not supported: " + glVersion);
      }

      if (this.glVersion == "webgl2") {
        this.glShaderVersion = "300 es";
      } else if (this.glVersion == "webgl") {
        this.glShaderVersion = "100";
      } else {
        throw "WebGL not supported";
      }

      console.log(
        "GL: " +
          this.glVersion +
          " / " +
          this.glShaderVersion +
          " -- " +
          this.gl.getParameter(this.gl.VERSION) +
          " -- " +
          this.gl.getParameter(this.gl.SHADING_LANGUAGE_VERSION)
      );

      // Vertex shader
      const vertexShader = this.gl.createShader(this.gl.VERTEX_SHADER);
      let vertexShaderSource;

      vertexShaderSource = `
        #version $version // "100" / "300 es"

        #if __VERSION__ == 100
          attribute vec4 vertexPosition;
          attribute vec4 color;
          varying vec4 vColor;
          attribute vec2 textureCoord;
          varying vec2 vTextureCoord;
        #else // __VERSION__ == 300
          in vec4 vertexPosition;
          in vec4 color;
          out vec4 vColor;
          in vec2 textureCoord;
          out vec2 vTextureCoord;
        #endif

        void main() {
          gl_Position = vertexPosition;
          vColor = color;
          vTextureCoord = textureCoord;
        }
      `;
      vertexShaderSource = vertexShaderSource.replaceAll(
        "$version",
        this.glShaderVersion
      );

      this.gl.shaderSource(vertexShader, vertexShaderSource.trim());
      this.gl.compileShader(vertexShader);
      if (!this.gl.getShaderParameter(vertexShader, this.gl.COMPILE_STATUS)) {
        throw this.gl.getShaderInfoLog(vertexShader);
      }

      // Fragment shader
      let fragmentShaderSource = `
        #version $version // "100" / "300 es"
        
        precision highp float;

        #if __VERSION__ == 100
          //uniform sampler2D
          varying vec4 vColor;
          //out vec4 gl_FragColor;
          varying vec2 vTextureCoord;
        #else // __VERSION__ == 300
          in vec4 vColor;
          out vec4 fragColor;
          in vec2 vTextureCoord;
        #endif

        uniform sampler2D uSampler;

        void main() {
          if ($useVertexColor) {
            #if __VERSION__ == 100
              gl_FragColor = vColor;
            #else
              fragColor = vColor;
            #endif
          } else {
            #if __VERSION__ == 100
              gl_FragColor = texture2D(uSampler, vTextureCoord);
            #else // __VERSION__ == 300
              fragColor = texture(uSampler, vTextureCoord);
            #endif
          }
        }
      `;
      fragmentShaderSource = fragmentShaderSource.replaceAll(
        "$version",
        this.glShaderVersion
      );
      fragmentShaderSource = fragmentShaderSource.replaceAll(
        "$useVertexColor",
        this.options.useVertexColor
      );

      const fragmentShader = this.gl.createShader(this.gl.FRAGMENT_SHADER);
      this.gl.shaderSource(fragmentShader, fragmentShaderSource.trim());
      this.gl.compileShader(fragmentShader);
      if (!this.gl.getShaderParameter(fragmentShader, this.gl.COMPILE_STATUS)) {
        throw this.gl.getShaderInfoLog(fragmentShader);
      }

      // Program
      const program = this.gl.createProgram();
      this.gl.attachShader(program, vertexShader);
      this.gl.attachShader(program, fragmentShader);
      this.gl.linkProgram(program);
      if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
        throw this.gl.getProgramInfoLog(program);
      }
      this.gl.useProgram(program);

      // Attributes
      this.vertexPosition = this.gl.getAttribLocation(
        program,
        "vertexPosition"
      );
      this.vertexColor = this.gl.getAttribLocation(program, "color");
      this.vertexTextureCoord = this.gl.getAttribLocation(
        program,
        "textureCoord"
      );

      // Uniforms
      this.uSampler = this.gl.getUniformLocation(program, "uSampler");

      // Buffers
      this.vertexBuffer = this.gl.createBuffer();
      this.colorBuffer = this.gl.createBuffer();
      this.textureCoordBuffer = this.gl.createBuffer();
    }

    // Update texture (gradient lookup) -- assumes array contents does not change
    if (this.lastColorLookup != colorLookup) {
      //console.log('Updating texture')
      this.lastColorLookup = colorLookup;

      // Create texture pixels from gradient lookup
      const pixels = new Uint8Array(colorLookup.colors.length * 4);
      for (let i = 0; i < colorLookup.colors.length; i++) {
        const color = colorLookup.colors[i];
        pixels[i * 4 + 0] = (color >> 16) & 0xff;
        pixels[i * 4 + 1] = (color >> 8) & 0xff;
        pixels[i * 4 + 2] = color & 0xff;
        pixels[i * 4 + 3] = 0xff;
      }

      // Create texture
      if (this.texture === null) {
        this.texture = this.gl.createTexture();
      }
      this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);
      this.gl.texImage2D(
        this.gl.TEXTURE_2D,
        0,
        this.gl.RGBA,
        colorLookup.colors.length,
        1,
        0,
        this.gl.RGBA,
        this.gl.UNSIGNED_BYTE,
        pixels
      );
      this.gl.activeTexture(this.gl.TEXTURE0);
      this.gl.uniform1i(this.uSampler, 0);

      // Clamp, no mipmap
      this.gl.texParameteri(
        this.gl.TEXTURE_2D,
        this.gl.TEXTURE_MIN_FILTER,
        this.gl.NEAREST
      );
      this.gl.texParameteri(
        this.gl.TEXTURE_2D,
        this.gl.TEXTURE_MAG_FILTER,
        this.gl.NEAREST
      );
      this.gl.texParameteri(
        this.gl.TEXTURE_2D,
        this.gl.TEXTURE_WRAP_S,
        this.gl.CLAMP_TO_EDGE
      );
      this.gl.texParameteri(
        this.gl.TEXTURE_2D,
        this.gl.TEXTURE_WRAP_T,
        this.gl.CLAMP_TO_EDGE
      );
    }

    // Update vertices
    if (pointsMoved) {
      // Vertices
      const vertices = [];
      const colors = [];
      const textureCoordinates = [];
      for (const cell of this.diagram.cells) {
        for (const halfedge of cell.halfedges) {
          const x0 = cell.site.x;
          const y0 = cell.site.y;
          const x1 = halfedge.getStartpoint().x;
          const y1 = halfedge.getStartpoint().y;
          const x2 = halfedge.getEndpoint().x;
          const y2 = halfedge.getEndpoint().y;

          vertices.push([x0 * 2 - 1, -(y0 * 2 - 1)]);
          vertices.push([x1 * 2 - 1, -(y1 * 2 - 1)]);
          vertices.push([x2 * 2 - 1, -(y2 * 2 - 1)]);

          // Placeholder colors, initially (overwritten below)
          colors.push([0, 0, 1, 1]);
          colors.push([1, 0, 0, 1]);
          colors.push([0, 1, 0, 1]);

          // Placeholder texture coordinates, initially (overwritten below)
          textureCoordinates.push([0.0, 0]);
          textureCoordinates.push([0.5, 0]);
          textureCoordinates.push([1.0, 0]);
        }
      }

      const vertexData = new Float32Array(vertices.flat());
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vertexBuffer);
      this.gl.bufferData(this.gl.ARRAY_BUFFER, vertexData, this.gl.STATIC_DRAW);
      this.gl.enableVertexAttribArray(this.vertexPosition);
      this.gl.vertexAttribPointer(
        this.vertexPosition,
        2,
        this.gl.FLOAT,
        false,
        0,
        0
      );

      this.colorData = new Float32Array(colors.flat());
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.colorBuffer);
      this.gl.bufferData(
        this.gl.ARRAY_BUFFER,
        this.colorData,
        this.gl.STATIC_DRAW
      );
      this.gl.enableVertexAttribArray(this.vertexColor);
      this.gl.vertexAttribPointer(
        this.vertexColor,
        4,
        this.gl.FLOAT,
        false,
        0,
        0
      );

      this.textureCoordData = new Float32Array(textureCoordinates.flat());
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.textureCoordBuffer);
      this.gl.bufferData(
        this.gl.ARRAY_BUFFER,
        this.textureCoordData,
        this.gl.STATIC_DRAW
      );
      this.gl.enableVertexAttribArray(this.vertexTextureCoord);
      this.gl.vertexAttribPointer(
        this.vertexTextureCoord,
        2,
        this.gl.FLOAT,
        false,
        0,
        0
      );
    }

    // Recalculate color data and texture coordinates
    let colorIndex = 0;
    let textureCoordIndex = 0;
    for (const cell of this.diagram.cells) {
      // Vertex 0: cell.site
      const value0 = cell.site.value;
      const color0 = this.getColor(colorLookup, value0);

      for (const halfedge of cell.halfedges) {
        // Vertex 1: halfedge.getStartpoint()
        const adjacent1 = halfedge.getStartpoint().adjacentSites;
        let value1 = 0;
        for (const site of adjacent1) {
          value1 += site.value;
        }
        if (adjacent1.length > 0) {
          value1 /= adjacent1.length;
        }
        const color1 = this.getColor(colorLookup, value1);

        // Vertex 2: halfedge.getEndpoint()
        const adjacent2 = halfedge.getEndpoint().adjacentSites;
        let value2 = 0;
        for (const site of adjacent2) {
          value2 += site.value;
        }
        if (adjacent2.length > 0) {
          value2 /= adjacent2.length;
        }
        const color2 = this.getColor(colorLookup, value2);

        // Write vertex color data
        colorIndex += this.writeColor(this.colorData, colorIndex, color0);
        colorIndex += this.writeColor(this.colorData, colorIndex, color1);
        colorIndex += this.writeColor(this.colorData, colorIndex, color2);

        // Write texture coordinate data
        this.textureCoordData[textureCoordIndex++] =
          (value0 - colorLookup.min) / (colorLookup.max - colorLookup.min);
        this.textureCoordBuffer[textureCoordIndex++] = 0;
        this.textureCoordData[textureCoordIndex++] =
          (value1 - colorLookup.min) / (colorLookup.max - colorLookup.min);
        this.textureCoordBuffer[textureCoordIndex++] = 0;
        this.textureCoordData[textureCoordIndex++] =
          (value2 - colorLookup.min) / (colorLookup.max - colorLookup.min);
        this.textureCoordBuffer[textureCoordIndex++] = 0;
      }
    }

    // Clear
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);

    // Update color data
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.colorBuffer);
    this.gl.bufferData(
      this.gl.ARRAY_BUFFER,
      this.colorData,
      this.gl.STATIC_DRAW
    );

    // Update texture data
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.textureCoordBuffer);
    this.gl.bufferData(
      this.gl.ARRAY_BUFFER,
      this.textureCoordData,
      this.gl.STATIC_DRAW
    );

    // Redraw using new values
    this.gl.drawArrays(this.gl.TRIANGLES, 0, colorIndex / 4); // vertices.length
  }

  // Update the image data from the point values
  update(points, colorLookup) {
    // If needed, resize the canvas
    if (
      !this.canvas ||
      this.canvas.width !== this.width ||
      this.canvas.height !== this.height
    ) {
      this.canvas = document.createElement("canvas");
      this.canvas.width = this.width;
      this.canvas.height = this.height;
    }

    if (this.options.mode == "nearest" || this.options.mode == "idf") {
      this.updatePerPixel(points, colorLookup);
    } else if (this.options.mode == "voronoi") {
      this.updateVoronoi(points, colorLookup);
    } else {
      throw `Unknown mode: ${this.options.mode}`;
    }
  }

  // Update the pattern image from the image data
  async draw() {
    if (!this.canvas) return;

    let blob = null;
    let blobUrl = null;
    if (this.options.useDataUri) {
      blobUrl = this.canvas.toDataURL("image/png");
    } else {
      blob = await new Promise((resolve) => this.canvas.toBlob(resolve));
      blobUrl = URL.createObjectURL(blob);
    }
    this.image.setAttribute("href", blobUrl);

    // Swap image
    const svgNS = this.element.namespaceURI;
    const nextImage = document.createElementNS(svgNS, "image");
    nextImage.setAttribute("visibility", "hidden");
    nextImage.setAttribute("href", "");
    nextImage.setAttribute("width", this.width);
    nextImage.setAttribute("height", this.height);
    // Prepending appears to help reduce the chance of flicker
    this.pattern.prepend(nextImage);

    // Wait until the image is loaded to help reduce the chance of flicker
    await new Promise((resolve, reject) => {
      nextImage.onload = resolve;
      nextImage.onerror = reject;
      nextImage.setAttribute("href", blobUrl);
    });

    // Make the new image visible
    nextImage.removeAttribute("visibility");

    // Wait until the next frame to help reduce the chance of flicker
    await new Promise((resolve) => {
      requestAnimationFrame(() => resolve());
    });

    // Remove old image
    this.image.remove();

    // The new image becomes current
    this.image = nextImage;

    // Remove the reference to the previous blob
    // In Chrome, check: chrome://blob-internals
    if (this.blobUrl != null && this.blobUrl.startsWith("blob:")) {
      URL.revokeObjectURL(this.blobUrl);
    }
    if (this.blob != null) {
      delete this.blob;
    }

    // Store the new blob
    this.blobUrl = blobUrl;
    this.blob = blob;
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
