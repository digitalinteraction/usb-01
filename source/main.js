import svgURL from "./usb-01.svg";
import floor from "./floor.json" assert { type: "json" };
import { ColorInterpolator } from "./color-interpolator.js";
import { PointImageInterpolator } from "./point-image-interpolator.js";

/**
  @typedef {Object} Point
  @property {number} x
  @property {number} y
  @property {number | null | undefined} value
  @property {HTMLElement} element
*/

/**
  @typedef {Object} ZoneRecord
  @property {PointImageInterpolator} interpolator
  @property {HTMLElement} elem
  @property {Point[]} points
  @property {(typeof floor)['spaces'][number]} space
  @property {Function} draw
  @property {Point} point
  @property {(typeof floor)['spaces'][number]['zones'][number]} zone
*/

const interpolationOptions = {
  mode: "voronoi",
  useDataUri: !false,
  useVertexColor: false,
  subdivide: 1,
  webgl: ["webgl2", "webgl"],
};

const unitShorthands = new Map([
  ["percent", "%"],
  ["degrees celsius", "°C"],
  ["percent relative humidity", "%rh"],
  ["luxes", " lux"],
  ["parts per million", " ppm"],
  ["unknown", ""],
]);

/** @type {SVGScriptElement} */
let svg = null;

const UO_BASE =
  location.hostname === "localhost"
    ? new URL("http://localhost:8080/api/v2/")
    : new URL("https://api.usb.urbanobservatory.ac.uk/api/v2/");

const canvas = document.getElementById("canvas");

/** @type {HTMLDialogElement} */
const popup = document.getElementById("popup");

/** @type {HTMLSelectField} */
const metric = document.getElementById("metric");

let isFetching = false;
let latestTimestamp = null;

const noValueColour = "white";

/** @type {keyof typeof gradients} */
let currentMetric = "room-temperature";

/** @type {Map<string, HTMLElement>} */
const rooms = new Map();

/** @type {Map<string, ZoneRecord>} */
const zones = new Map();

const gradients = {
  "room-temperature": createGradient(
    [
      { offset: 0, color: "#663399" },
      { offset: 16, color: "#82c3d0" },
      { offset: 18, color: "#ABCE82" },
      { offset: 20, color: "#FECB01" },
      { offset: 22, color: "#FC7F0A" },
      { offset: 24, color: "#fd3814" },
      { offset: 42.5, color: "#770600" },
    ],
    [15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25],
    "℃",
  ),
  "occupancy-sensor": createGradient(
    [
      { offset: 0, color: "#0c087a" },
      { offset: 1, color: "#74e7ee" },
    ],
    [0, 1],
  ),

  // https://www.kane.co.uk/knowledge-centre/what-are-safe-levels-of-co-and-co2-in-rooms
  co2: createGradient(
    [
      { offset: 0, color: "#FFFFFF" },
      { offset: 400, color: "#00FF00" },
      { offset: 800, color: "#0000FF" },
      { offset: 1_200, color: "#FF0000" },
    ],
    [0, 200, 400, 600, 800, 1_200],
    "ppm",
  ),
  "room-brightness": createGradient(
    [
      { offset: 0, color: "#000000" },
      { offset: 500, color: "#FFFFFF" },
    ],
    [0, 100, 200, 300, 400, 500],
    "lux",
  ),
};

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

function createGradient(stops, legend, units = null) {
  const colors = new ColorInterpolator(stops);
  const lookup = colors.createLookup(1024);
  return { colors, lookup, legend, units };
}

function lookupZone(id) {
  for (const space of floor.spaces) {
    const found = space.zones.find((z) => z.selector === `#${id}`);
    if (found) return found;
  }
  return null;
}

async function main() {
  svg = new DOMParser()
    .parseFromString(await fetch(svgURL).then((r) => r.text()), "image/svg+xml")
    .querySelector("svg");

  canvas.appendChild(svg);

  // rooms
  for (const room of floor.rooms) {
    const elem = svg.querySelector(room.floorSelector);
    if (!elem) {
      console.error("room not found", room.floorSelector);
      continue;
    }
    rooms.set(room.entityId, elem);
    elem.addEventListener("click", () =>
      showEntity(room.entityId, room.feeds, room.labelSelector),
    );
  }

  // spaces
  for (const space of floor.spaces) {
    const elem = svg.querySelector(space.floorSelector);

    if (!elem) {
      console.error("room not found", space.floorSelector);
      continue;
    }

    const points = PointImageInterpolator.extractGroupSiblingPoints(
      elem,
      "circle",
    );
    const interpolator = new PointImageInterpolator(elem, interpolationOptions);

    const record = {
      interpolator,
      elem,
      points,
      space,
      draw: debounce(500, () => interpolator.draw()),
    };

    for (const zone of space.zones) {
      for (const point of points) {
        point.element.style.pointerEvents = "none";
        // TODO: not a great comparison...
        if ("#" + point.element.id === zone.selector) {
          zones.set(zone.entityId, { ...record, point, zone });
        }
      }
    }

    elem.addEventListener("click", (e) => {
      const zone = findNearestNode(
        e.clientX,
        e.clientY,
        points.map((p) => p.element),
        50,
      );

      if (zone) {
        const record = lookupZone(zone.id);
        if (record) showEntity(record.entityId, record.feeds);
      }
    });
  }

  const url = new URL(location.href);
  if (
    url.searchParams.has("metric") &&
    gradients[url.searchParams.get("metric")]
  ) {
    metric.value = url.searchParams.get("metric");
    currentMetric = url.searchParams.get("metric");
  }

  drawLegend();

  metric.addEventListener("input", async () => {
    currentMetric = metric.value;
    drawLegend();
    clearData();
    await fetchData();
    // TODO: should fetches be in a Q?
    const url = new URL(location.href);
    url.searchParams.set("metric", metric.value);
    history.pushState(null, null, url);
  });

  clearData();
  await fetchData();
  setInterval(() => fetchData(), 60_000);
}

/**
  @param {number} x
  @param {number} y
  @param {Element[]} nodes
 */
function findNearestNode(targetX, targetY, nodes, threshold = Infinity) {
  let nearest = null;
  let nearestSq = threshold ** 2;
  for (const node of nodes) {
    const rect = node.getBoundingClientRect();
    const nodeX = rect.x + rect.width * 0.5;
    const nodeY = rect.y + rect.height * 0.5;
    const distSq = Math.pow(targetX - nodeX, 2) + Math.pow(targetY - nodeY, 2);
    if (distSq < nearestSq) {
      nearestSq = distSq;
      nearest = node;
    }
  }
  return nearest;
}

function drawLegend() {
  const wrapper = document.getElementById("legend");

  const p = wrapper.querySelector("p");
  const ul = wrapper.querySelector("ul");

  p.textContent = "Legend";
  ul.innerHTML = "";
  ul.setAttribute("role", "list");

  const { colors, legend, units } = gradients[currentMetric];

  if (units) p.textContent += " / " + units;

  for (const i of legend) {
    const li = ul.appendChild(document.createElement("li"));
    const colour = li.appendChild(document.createElement("span"));
    li.appendChild(document.createTextNode(`${i}`));

    colour.classList.add("legendColour");
    colour.style.setProperty(
      "--colour",
      ColorInterpolator.toColorString(colors.interpolateColor(i)),
    );
  }
}

/** @param {Date | null} value */
function drawTimestamp(value) {
  const label = document.getElementById("timestamp");

  if (value instanceof Date) {
    const fmt = new Intl.DateTimeFormat(navigator.language, {
      dateStyle: "short",
      timeStyle: "short",
    });
    label.textContent = `Latest data: ${fmt.format(value)}`;
  } else {
    label.textContent = "Latest data: unknown";
  }
}

async function fetchEntity(entityId) {
  const res = await fetch(
    new URL(`./sensors/entity/${entityId}`, UO_BASE),
  ).catch(() => null);

  if (!res?.ok) {
    console.error("fetch entity failed: " + res.statusText);
    return null;
  }

  return res.json();
}

async function fetchFeed(feedId) {
  const res = await fetch(new URL(`./sensors/feed/${feedId}`, UO_BASE)).catch(
    () => null,
  );

  if (!res?.ok) {
    console.error("fetch feed failed: " + res.statusText);
    return null;
  }

  return res.json();
}

function clearData() {
  for (const room of floor.rooms) {
    onFeedData(room.entityId, null);
  }
  for (const space of floor.spaces) {
    for (const zone of space.zones) {
      onFeedData(zone.entityId, null);
    }
  }
}

async function fetchData() {
  if (isFetching) return;
  isFetching = true;
  latestTimestamp = null;

  for (const room of floor.rooms) {
    if (!room.feeds[currentMetric]) {
      onFeedData(room.entityId, null);
      continue;
    }
    const data = await fetchFeed(room.feeds[currentMetric]);
    onFeedData(room.entityId, data);
  }

  for (const space of floor.spaces) {
    for (const zone of space.zones) {
      if (!zone.feeds[currentMetric]) {
        onFeedData(zone.entityId, null);
        continue;
      }
      const data = await fetchFeed(zone.feeds[currentMetric]);
      onFeedData(zone.entityId, data);
    }
  }

  isFetching = false;
}

function onFeedData(entityId, data) {
  let elem = rooms.get(entityId);
  const room = floor.rooms.find((r) => r.entityId === entityId);
  const zone = zones.get(entityId);
  const latest = data?.timeseries?.[0]?.latest;

  const { colors, lookup } = gradients[currentMetric];

  if (elem && room) {
    console.debug("onFeedData room", elem.id, latest);

    if (typeof latest?.value === "number") {
      elem.setAttribute(
        "fill",
        ColorInterpolator.toColorString(colors.interpolateColor(latest.value)),
      );
    } else {
      elem.setAttribute("fill", noValueColour);
    }
  }

  if (zone) {
    console.debug("onFeedData zone", zone.zone.selector, latest);

    if (typeof latest?.value === "number") {
      zone.point.value = latest.value;
      zone.interpolator.update(zone.points, lookup);
      zone.draw();
    } else {
      zone.point.value = null;
    }
  }

  if (typeof latest?.time === "string") {
    const date = new Date(latest.time);
    if (!Number.isNaN(date.getTime())) {
      if (!latestTimestamp || date.getTime() > latestTimestamp.getTime()) {
        latestTimestamp = date;
      }
    }
    drawTimestamp(latestTimestamp);
  }
}

/** 
  @param {string} entityId
  @param {Record<string, string>} feeds
*/
async function showEntity(entityId, feeds, labelSelector = null) {
  const entity = await fetchEntity(entityId);
  if (!entity) return;

  const fmt = new Intl.DateTimeFormat(navigator.language, {
    dateStyle: "short",
    timeStyle: "short",
  });

  const label = labelSelector ? document.querySelector(labelSelector) : null;

  const attributes = [];

  // const rows = [];
  for (const feedId of Object.values(feeds)) {
    const feed = entity.feed.find((f) => f.feedId === feedId);
    const { value, time } = feed.timeseries[0]?.latest ?? {};
    const unit = feed.timeseries[0]?.unit?.name;

    if (/occupancy/i.test(feed.metric)) {
      attributes.push({ key: feed.metric, value: value ? "Yes" : "No" });
    } else if (value) {
      const date = new Date(time ?? "invalid date");
      const u = unit ? unitShorthands.get(unit) ?? ` ${unit}` : "";

      attributes.push({
        key: feed.metric,
        value: `${value}${u}`,
        title: Number.isNaN(date.getTime()) ? "" : fmt.format(date),
      });
    } else {
      // rows.push(`<dd>no value</dd>`);
    }
  }

  const title = (label?.textContent ?? entity.name ?? "Room").replace(
    /Urban Sciences Building: Floor 1: /i,
    "",
  );

  const dataItems = attributes
    .sort((a, b) => a.key.localeCompare(b.key))
    .map(
      (row) => `<dt>${row.key}</dt><dd title="${row.title}">${row.value}</dd>`,
    )
    .join("\n");

  popup.showModal();
  popup.innerHTML = `
    <h2>${title}</h2>
    <dl class="tableList">${dataItems}</dl>
    <cluster-layout class="toolbar">
      <form method="dialog">
        <button>Close</button>
      </form>
    </cluster-layout>
  `;

  popup.querySelector("button").addEventListener("click", (e) => {
    e.preventDefault();
    popup.close();
  });
}

main().catch((e) => console.error("fatal error", e));
