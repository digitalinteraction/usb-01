import svgURL from "./usb-01.svg";
import floorData from "./floor.json" assert { type: "json" };

/** @type {SVGScriptElement} */
let svg = null;

// const UO_BASE = new URL("https://api.usb.urbanobservatory.ac.uk/api/v2");
const UO_BASE = new URL("http://localhost:8080/api/v2/");
const canvas = document.getElementById("canvas");

const noValueColour = "transparent";
const mode = "temperature";
const rooms = new Map();

function interpolate(minValue, maxValue, minOut, maxOut, fn) {
  return (value) => {
    // Calculate the hue value based on the temperature
    // prettier-ignore
    return fn(((value - minValue) / (maxValue - minValue)) * (maxOut - minOut) + minOut);

    // Convert the hue to an RGB color
    // return `hsl(${hue}, 100%, 70%)`;
  };
}

const gradients = {
  temperature: interpolate(15, 25, 200, 100, (hue) => `hsl(${hue}, 100%, 70%)`),
  co2: interpolate(300, 500, 120, 0, (hue) => `hsl(${hue}, 100%, 70%)`),
  brightness: interpolate(0, 100, 0, 1, (v) => `rgb(${v}, ${v}, ${v})`),
};

async function main() {
  svg = new DOMParser()
    .parseFromString(await fetch(svgURL).then((r) => r.text()), "image/svg+xml")
    .querySelector("svg");

  canvas.appendChild(svg);

  for (const room of floorData.rooms) {
    const elem = svg.querySelector(room.selector);
    if (!elem) {
      console.error("room not found", room.selector);
      continue;
    }
    rooms.set(room.entityId, elem);
    elem.addEventListener("click", (e) => onRoomClick(room, e));
  }

  svg.addEventListener("click", (e) => {
    const rect = e.target.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    console.log(x, y, e.target.id);
  });

  await fetchData();
  setInterval(() => fetchData(), 10_000);
}

async function fetchData() {
  for (const room of floorData.rooms) {
    const res = await fetch(
      new URL(`./sensors/entity/${room.entityId}`, UO_BASE)
    );
    if (!res.ok) continue;

    res.json().then((d) => onEntityData(d));
  }
}

function onEntityData(data) {
  let elem = rooms.get(data.entityId);
  const room = floorData.rooms.find((r) => r.entityId === data.entityId);

  if (elem && room) {
    console.log(elem.id, data);

    const feedId = room.feeds[mode];
    const feed = data.feed.find((f) => f.feedId === feedId);

    const latest = feed?.timeseries?.[0]?.latest?.value;
    if (latest) {
      elem.setAttribute("fill", gradients[mode](latest));
      elem.setAttribute("title", latest);
    } else {
      elem.setAttribute("fill", noValueColour);
      elem.setAttribute("title", "No value");
    }
  }

  // TODO: "spaces"
}

async function onRoomClick(_room, e) {
  const title = e.target?.getAttribute("title");
  if (title) alert(`Value: ${title}`);
}

main().catch((e) => console.error("fatal error", e));
