import svgURL from "./usb-01.svg";
import floor from "./floor.json" assert { type: "json" };
import { ColorInterpolator } from "./color-interpolator.js";
import { PointImageInterpolator } from "./point-image-interpolator.js";

/** @type {SVGScriptElement} */
let svg = null;

const UO_BASE =
  location.hostname === "localhost"
    ? new URL("http://localhost:8080/api/v2/")
    : new URL("https://api.usb.urbanobservatory.ac.uk/api/v2");

const canvas = document.getElementById("canvas");

const noValueColour = "transparent";
const mode = "room-temperature";
const rooms = new Map();
const spaces = new Map();
const zones = new Map();

// Color stops for expected temperature range
// const temperatureColours = new ColorInterpolator([
//   { offset: 0, color: "#360F62" },
//   { offset: 18, color: "#0C84FD" },
//   { offset: 19, color: "#5AC8F7" },
//   { offset: 20, color: "#6CD3C6" },
//   { offset: 21, color: "#E6CD21" },
//   { offset: 22, color: "#FE8707" },
//   { offset: 23, color: "#750700" },
// ]);
const temperatureColours = new ColorInterpolator([
  { offset: -20, color: "#3C1873" }, // sea green
  { offset: 0, color: "#5ACAF3" }, // yellow
  { offset: 10, color: "#64D3D0" },
  { offset: 15, color: "#9FD082" },
  { offset: 20, color: "#E1CF29" },
  { offset: 25, color: "#FECB01" },
  { offset: 30, color: "#FC7F0A" },
  { offset: 42.5, color: "#FF3F2C" },
  { offset: 55, color: "#770600" },
]);
// const temperatureColours = new ColorInterpolator([
//   { offset: -26, color: "#000000" }, // black
//   { offset: 0, color: "#663399" }, // dark purple
//   { offset: 16, color: "#333399" }, // dark blue
//   { offset: 18, color: "#339999" }, // turquoise
//   { offset: 20, color: "#339966" }, // sea green
//   { offset: 22, color: "#dddd00" }, // yellow
//   { offset: 24, color: "#dd6600" }, // red-orange
//   { offset: 26, color: "#dd3300" }, // dark red
//   { offset: 32, color: "#ff0000" }, // bright red
//   { offset: 42, color: "#ff00ff" }, // magenta
// ]);
const temperatureLookup = temperatureColours.createLookup(1024);

function interpolate(minValue, maxValue, minOut, maxOut, fn) {
  return (value) => {
    // Calculate the hue value based on the temperature
    // prettier-ignore
    return fn(((value - minValue) / (maxValue - minValue)) * (maxOut - minOut) + minOut);

    // Convert the hue to an RGB color
    // return `hsl(${hue}, 100%, 70%)`;
  };
}

function debounce(ms, fn) {
  let timerId = null;
  return () => {
    if (timerId) clearTimeout(timerId);
    timerId = setTimeout(() => {
      timerId = null;
      fn();
    }, ms);
  };
}

const gradients = {
  // "room-temperature": interpolate(
  //   15,
  //   25,
  //   200,
  //   100,
  //   (hue) => `hsl(${hue}, 100%, 70%)`,
  // ),
  "room-temperature"(value) {
    return ColorInterpolator.toColorString(
      temperatureColours.interpolateColor(value),
    );
  },
  co2: interpolate(300, 500, 120, 0, (hue) => `hsl(${hue}, 100%, 70%)`),
  "room-brightness": interpolate(0, 100, 0, 1, (v) => `rgb(${v}, ${v}, ${v})`),
};

async function main() {
  svg = new DOMParser()
    .parseFromString(await fetch(svgURL).then((r) => r.text()), "image/svg+xml")
    .querySelector("svg");

  canvas.appendChild(svg);

  for (const room of floor.rooms) {
    const elem = svg.querySelector(room.selector);
    if (!elem) {
      console.error("room not found", room.selector);
      continue;
    }
    rooms.set(room.entityId, elem);
    elem.addEventListener("click", (e) => onRoomClick(room, e));
  }

  // spaces
  for (const space of floor.spaces) {
    const elem = svg.querySelector(space.selector);

    if (!elem) {
      console.error("room not found", space.selector);
      continue;
    }

    const points = PointImageInterpolator.extractGroupSiblingPoints(
      elem,
      "circle",
    );
    console.log(points);
    const interpolator = new PointImageInterpolator(elem);

    const record = {
      interpolator,
      elem,
      points,
      space,
      draw: debounce(500, () => {
        interpolator.draw();
      }),
    };
    spaces.set(space.selector, record);

    for (const zone of space.zones) {
      for (const point of points) {
        // not great...
        if ("#" + point.element.id === zone.selector) {
          zones.set(zone.entityId, { ...record, point, zone });
        }
      }
    }
  }

  svg.addEventListener("click", (e) => {
    const rect = e.target.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    console.log(x, y, e.target.id);
  });

  await fetchData();
  setInterval(() => fetchData(), 60_000);
}

async function fetchData() {
  for (const room of floor.rooms) {
    const res = await fetch(
      new URL(`./sensors/entity/${room.entityId}`, UO_BASE),
    );
    if (!res.ok) continue;

    res.json().then((d) => onEntityData(d));
  }

  for (const space of floor.spaces) {
    for (const zone of space.zones) {
      const res = await fetch(
        new URL(`./sensors/entity/${zone.entityId}`, UO_BASE),
      );
      if (!res.ok) continue;

      res.json().then((d) => onEntityData(d));
    }
  }
}

async function onEntityData(data) {
  let elem = rooms.get(data.entityId);
  const room = floor.rooms.find((r) => r.entityId === data.entityId);
  const zone = zones.get(data.entityId);

  if (elem && room) {
    const feedId = room.feeds[mode];
    const feed = data.feed.find((f) => f.feedId === feedId);

    const latest = feed?.timeseries?.[0]?.latest?.value;
    console.log(elem.id, latest);

    if (latest) {
      elem.setAttribute("fill", gradients[mode](latest));
      elem.setAttribute("title", latest);
    } else {
      elem.setAttribute("fill", noValueColour);
      elem.setAttribute("title", "No value");
    }
  }

  // interpolator: new PointImageInterpolator(elem),
  // elem,
  // points,
  // point
  // draw

  if (zone) {
    const feedId = zone.zone.feeds[mode];
    const feed = data.feed.find((f) => f.feedId === feedId);

    const latest = feed?.timeseries?.[0]?.latest?.value;
    console.debug(zone.zone.selector, latest);

    if (latest) {
      zone.point.value = latest;
      zone.interpolator.update(zone.points, temperatureLookup);
      zone.draw();
    } else {
      zone.point.value = null;
    }
  }
}

async function onRoomClick(_room, e) {
  const title = e.target?.getAttribute("title");
  if (title) alert(`Value: ${title}`);
}

main().catch((e) => console.error("fatal error", e));

//
//
//

// Element to draw interpolated image to
// const element = document.querySelector("#shape");

// Point interpolator
// const pointImageInterpolator = new PointImageInterpolator(element);

// Extract point coordinates from parent group matching 'circle'
// const points = PointImageInterpolator.extractGroupSiblingPoints(
//   element,
//   "circle",
// );
//
// // Draw and randomly animate points
// async function update() {
//   pointImageInterpolator.update(points, colorLookup);
//   await pointImageInterpolator.draw();
//   for (const point of points) {
//     //point.x += Math.random() * 0.01 - 0.005;
//     //point.y += Math.random() * 0.01 - 0.005;
//     if (point.value == null) point.value = 20;
//     point.value += Math.random() * 2 - 1;
//   }
// }
// setInterval(() => update(), 100);
// update();
