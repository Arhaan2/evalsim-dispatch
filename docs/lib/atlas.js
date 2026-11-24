// An original schematic of the fictional Meridian Harbor network. The geographic
// backdrop is decorative; routes and moving cargo come from the simulator.
export const locations = {
  s0: { name: "Northworks", kind: "Supplier", x: 112, y: 82, side: -1 },
  s1: { name: "South Pier", kind: "Supplier", x: 108, y: 285, side: 1 },
  w0: { name: "West Yard", kind: "Warehouse", x: 314, y: 126, side: -1 },
  w1: { name: "East Yard", kind: "Warehouse", x: 420, y: 254, side: 1 },
  c0: { name: "Market", kind: "Customer", x: 555, y: 73, side: -1 },
  c1: { name: "Marina", kind: "Customer", x: 697, y: 143, side: -1 },
  c2: { name: "Heights", kind: "Customer", x: 674, y: 312, side: 1 },
  c3: { name: "Old Town", kind: "Customer", x: 554, y: 235, side: 1 },
};

const north =
  "M-12 -12H813V130L783 138 763 147 741 145 721 157 702 155 681 164 656 156 641 160 623 154 609 161 592 163 575 157 552 161 531 150 510 148 493 139 468 141 444 133 425 137 404 133 383 140 354 137 328 151 312 149 292 156 278 153 264 160 237 159 214 171 193 174 177 169 161 175 145 171 134 177 118 173 92 184 70 184 57 192 41 188 26 193 15 190 -12 201Z";
const south =
  "M-12 260L7 249 26 256 45 249 62 252 82 242 109 247 130 238 150 244 172 237 191 240 210 231 234 235 252 226 269 232 291 221 308 226 327 214 348 219 363 213 377 215 393 204 417 210 439 198 458 204 476 197 495 201 511 195 533 200 553 195 569 201 591 200 605 207 626 205 641 213 664 213 686 221 704 218 726 224 748 217 769 221 790 215 812 222V384H-12Z";
const island = "M568 179q11 -9 24 -7l17 3 -4 7 -18 4 -14 -1Z";
const road = {
  // Curved links separate the two warehouses' choices and meet at real endpoints.
  "w0-c0": [
    [314, 126],
    [366, 91],
    [417, 87],
    [477, 87],
    [555, 73],
  ],
  "w0-c1": [
    [314, 126],
    [367, 108],
    [435, 110],
    [490, 122],
    [572, 112],
    [634, 122],
    [697, 143],
  ],
  "w0-c2": [
    [314, 126],
    [361, 141],
    [415, 168],
    [465, 195],
    [511, 213],
    [588, 259],
    [674, 312],
  ],
  "w0-c3": [
    [314, 126],
    [355, 148],
    [393, 181],
    [448, 206],
    [500, 224],
    [554, 235],
  ],
  "w1-c0": [
    [420, 254],
    [443, 211],
    [474, 166],
    [502, 129],
    [528, 105],
    [555, 73],
  ],
  "w1-c1": [
    [420, 254],
    [455, 224],
    [493, 211],
    [553, 201],
    [607, 180],
    [647, 162],
    [697, 143],
  ],
  "w1-c2": [
    [420, 254],
    [472, 274],
    [522, 283],
    [582, 285],
    [637, 300],
    [674, 312],
  ],
  "w1-c3": [
    [420, 254],
    [463, 245],
    [510, 244],
    [554, 235],
  ],
};

function smooth(points) {
  const [first, ...rest] = points;
  let path = "M" + first.join(",");
  rest.forEach((p, i) => {
    const next = rest[i + 1];
    path += next
      ? "Q" +
        p.join(",") +
        " " +
        (p[0] + next[0]) / 2 +
        "," +
        (p[1] + next[1]) / 2
      : "L" + p.join(",");
  });
  return path;
}

function pathFor(from, to) {
  const a = locations[from],
    b = locations[to];
  if (!a || !b) return "";
  const fixed = road[from + "-" + to];
  if (fixed) return smooth(fixed);
  return smooth([
    [a.x, a.y],
    [(a.x + b.x) / 2 - 14, a.y],
    [(a.x + b.x) / 2 + 10, b.y],
    [b.x, b.y],
  ]);
}

function random(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function buildings(rng, x, y, cols, rows, size, industrial = false) {
  let result = "";
  const palette = industrial
    ? ["#aab1ad", "#c2c4b7", "#b6b9ad", "#9aa9a8"]
    : ["#a9b6ac", "#bdc4b5", "#adb8ad", "#c6c6b6", "#a6b6ae"];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (rng() < 0.15) continue;
      const cx = x + col * size * 1.85 - row * size * 1.25;
      const cy = y + row * size * 0.83 + col * size * 0.49;
      const w = size * (0.5 + rng() * 0.3),
        d = size * (0.35 + rng() * 0.2),
        h = size * (0.3 + rng() * 0.65);
      const tone = palette[Math.floor(rng() * palette.length)];
      result +=
        '<g transform="translate(' +
        cx.toFixed(1) +
        " " +
        cy.toFixed(1) +
        ')"><path d="M0 0l' +
        w +
        " " +
        w * 0.34 +
        " " +
        d +
        " " +
        -d * 0.55 +
        " -" +
        w +
        " -" +
        w * 0.34 +
        'Z" fill="' +
        tone +
        '"/><path d="M0 0l' +
        w +
        " " +
        w * 0.34 +
        "v" +
        h +
        "l-" +
        w +
        " -" +
        w * 0.34 +
        'Z" fill="#9ba79d"/><path d="M' +
        w +
        " " +
        w * 0.34 +
        "l" +
        d +
        " -" +
        d * 0.55 +
        "v" +
        h +
        "l-" +
        d +
        " " +
        d * 0.55 +
        'Z" fill="#89988e"/></g>';
    }
  }
  return result;
}

function woodland(rng, x, y, rx, ry, count) {
  let trees = "";
  for (let i = 0; i < count; i++) {
    const a = rng() * Math.PI * 2,
      r = Math.sqrt(rng());
    const tx = x + Math.cos(a) * rx * r,
      ty = y + Math.sin(a) * ry * r;
    const h = 3 + rng() * 3;
    trees +=
      '<path d="M' +
      tx.toFixed(1) +
      " " +
      ty.toFixed(1) +
      "l" +
      h * 0.48 +
      " " +
      -h +
      " " +
      h * 0.48 +
      " " +
      h +
      'Z" fill="' +
      (i % 2 ? "#97ac95" : "#b4c3a7") +
      '"/>';
  }
  return trees;
}

function quay(x, y) {
  let markup = "";
  for (let i = 0; i < 4; i++) {
    const px = x + i * 13;
    markup +=
      '<g transform="translate(' +
      px +
      " " +
      (y - i * 1.4) +
      ')"><path d="M0 2v-11m-3 12 3-5 3 5m-6-10 12-6 1 1-10 8m8-8v7" fill="none" stroke="#6d8581" stroke-width="1.2"/></g>';
  }
  return markup;
}

function terminal(x, y, small = false) {
  // Low-roof freight sheds, transshipment stacks and the loading apron give
  // the two yards a different silhouette from the surrounding neighborhoods.
  let out =
    '<g transform="translate(' +
    x +
    " " +
    y +
    ") scale(" +
    (small ? 0.79 : 1) +
    ')">';
  out +=
    '<path d="m-34 7 33-15 41 13-34 19z" fill="#b9c1ad" stroke="#a8b4a4" stroke-width=".7"/>';
  out +=
    '<path d="m-29 3 17-8 15 5-17 9z" fill="#839a9a"/><path d="m-29 3 15 6v4l-15-6z" fill="#859486"/><path d="m-14 9 17-9v4l-17 9z" fill="#697e77"/>';
  out +=
    '<path d="m-25 2 13-6m-9 8 13-6m-9 8 13-6" stroke="#acb9b3" fill="none" stroke-width=".7"/>';
  const colors = ["#87977f", "#668372", "#b8c994", "#8b9990", "#52665b"];
  for (let row = 0; row < 3; row++)
    for (let col = 0; col < 4; col++) {
      const tx = -6 + col * 7 - row * 5,
        ty = 8 + col * 1.9 + row * 2.6;
      out +=
        '<g transform="translate(' +
        tx +
        " " +
        ty +
        ')"><path d="m0 0 5.5-2.7 4 1.3-5.5 3z" fill="' +
        colors[(row + col * 2) % 5] +
        '"/><path d="m0 0 4 1.6v2l-4-1.6zm4 1.6 5.5-3v2l-5.5 3z" fill="#7d8275"/></g>';
    }
  return out + "</g>";
}

function terrain(key) {
  const rng = random(1317);
  const clip = "land-" + key;
  let generated = "";
  for (const area of [
    [-5, 109, 6, 4, 10],
    [159, -15, 9, 4, 11],
    [159, 64, 5, 4, 9],
    [238, 108, 6, 3, 8],
    [326, 26, 6, 4, 8],
    [480, 12, 9, 4, 7],
    [570, 46, 7, 4, 9],
    [652, 91, 9, 4, 8],
    [748, 21, 8, 7, 9],
    [25, 290, 6, 6, 9],
    [178, 261, 5, 3, 10],
    [282, 253, 6, 4, 8],
    [442, 280, 5, 5, 10],
    [515, 311, 7, 5, 10],
    [603, 249, 6, 5, 8],
    [716, 282, 7, 6, 9],
  ])
    generated += buildings(rng, ...area);
  for (const patch of [
    [54, 21, 66, 37, 130],
    [308, -6, 48, 25, 65],
    [436, 66, 50, 29, 65],
    [713, 13, 78, 37, 145],
    [772, 350, 62, 50, 120],
    [295, 344, 51, 34, 120],
    [172, 346, 32, 20, 70],
  ])
    generated += woodland(rng, ...patch);
  let contours = "";
  for (let i = 0; i < 9; i++) {
    contours +=
      '<path d="M-5 ' +
      (4 + i * 3.8) +
      "q45 61 85 12t85 -38M380 " +
      (-13 + i * 4) +
      "q3 33 51 23t55 -42M726 " +
      (-20 + i * 3.2) +
      "q5 24 23 26t62 6M220 " +
      (370 + i * 4) +
      "q31 -52 74 -54t71 62M746 " +
      (300 + i * 4) +
      'q19 24 37 21t37 -5" fill="none" stroke="#a3b59d" stroke-width=".8"/>';
  }
  let ripples = "";
  for (let i = 0; i < 210; i++) {
    const x = rng() * 800,
      y = 135 + rng() * 137;
    ripples +=
      '<path d="M' +
      x.toFixed(1) +
      " " +
      y.toFixed(1) +
      'q3 -1 7 -.4" stroke="#9ebba8" opacity=".8" fill="none" stroke-width=".8"/>';
  }
  let streets = "";
  for (const d of [
    "M-15 85 63 102 118 73 201 75 241 41 304 35 361 49 407 41 461 16 580 45 627 67 708 50 819 77",
    "M5 150 63 128 129 138 199 118 250 127 312 108 368 77 434 88 505 52 557 68 615 92 718 93 822 117",
    "M90 -5 123 44 178 76 198 118 230 160",
    "M300 -10 279 29 291 61 316 107 354 142",
    "M533 -10 555 29 558 69 579 108 596 163",
    "M694 -9 681 39 716 93 706 139",
    "M-11 321 97 275 184 282 252 255 315 252 373 273 447 253 503 218 564 232 641 246 695 264 811 239",
    "M11 372 103 326 184 337 248 296 302 307 352 292 415 317 484 302 538 326 595 304 664 333 711 308 818 335",
    "M187 222 193 253 186 284 212 319 210 376",
    "M395 199 398 228 421 253 413 312 436 372",
    "M595 203 597 237 624 258 631 289 661 333 653 375",
  ]) {
    streets +=
      '<path d="' +
      d +
      '" fill="none" stroke="#b9bda9" stroke-width="4.3" stroke-linejoin="round"/><path d="' +
      d +
      '" fill="none" stroke="#e8e6cf" stroke-width="2.4" stroke-linejoin="round"/>';
  }
  return (
    '<defs><clipPath id="' +
    clip +
    '"><path d="' +
    north +
    '"/><path d="' +
    south +
    '"/></clipPath></defs><rect width="800" height="366" fill="#bad0c0"/>' +
    ripples +
    [north, south, island]
      .map(
        (d) =>
          '<path d="' +
          d +
          '" fill="#e5eade" stroke="#d1dfd0" stroke-width="13" stroke-linejoin="round"/><path d="' +
          d +
          '" fill="#e5eade" stroke="#a9bbaa" stroke-width="1"/>',
      )
      .join("") +
    '<g clip-path="url(#' +
    clip +
    ')">' +
    contours +
    streets +
    generated +
    terminal(76, 85, true) +
    terminal(132, 276, true) +
    terminal(280, 126) +
    terminal(386, 256) +
    "</g>" +
    '<g fill="#b5b8a5" stroke="#889a91" stroke-width=".7"><path d="m218 162 8-2 8 18-8 3z m24-7 6-2 6 15-6 2z m-65 15 7-2 7 16-8 3z m281 29 8 1-3-20-7 1z m16-3 6-1-1-16-6 1z"/></g>' +
    quay(183, 167) +
    quay(433, 202) +
    '<text x="104" y="216" class="water-name" transform="rotate(-6 104 216)">Meridian Sound</text>'
  );
}

function escapeText(text) {
  return String(text).replace(
    /[&<>"]/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch],
  );
}

function marker(id, node) {
  const isSupplier = node.kind === "Supplier",
    isWarehouse = node.kind === "Warehouse";
  const shape = isSupplier
    ? '<path d="m0 -6 6 6-6 6-6-6z"/>'
    : isWarehouse
      ? '<rect x="-5.5" y="-5.5" width="11" height="11" rx="1.3"/>'
      : '<circle r="4.7"/>';
  const w = node.name.length * 7.3 + 12;
  const ly = node.side < 0 ? -25 : 16;
  return (
    '<g class="station ' +
    (isWarehouse ? "depot" : isSupplier ? "supplier" : "customer") +
    '" data-node="' +
    id +
    '" role="button" tabindex="0" aria-label="' +
    node.name +
    ", " +
    node.kind +
    '"><title>' +
    node.name +
    " · " +
    node.kind +
    '</title><g transform="translate(' +
    node.x +
    " " +
    node.y +
    ')"><circle r="13" fill="transparent"/><g class="marker">' +
    shape +
    '</g><rect class="station-label" x="' +
    -w / 2 +
    '" y="' +
    ly +
    '" width="' +
    w +
    '" height="17" rx="3"/><text y="' +
    (ly + 12) +
    '" text-anchor="middle">' +
    node.name +
    "</text></g></g>"
  );
}

export function createAtlas(svg, key) {
  svg.setAttribute("viewBox", "0 0 800 366");
  svg.setAttribute("preserveAspectRatio", "xMidYMid slice");
  svg.innerHTML =
    "<title>Meridian Harbor freight network</title>" +
    terrain(key) +
    '<g class="routes"></g><g class="cargo"></g><g class="stations">' +
    Object.entries(locations)
      .map(([id, node]) => marker(id, node))
      .join("") +
    '</g><g class="compass" transform="translate(768 33)" aria-hidden="true"><circle r="15" fill="#fffefa" opacity=".93"/><path d="m0-10 4 14-4-3-4 3z" fill="#3c5050"/><text y="26" text-anchor="middle">N</text></g>';
  let previousRoutes = "",
    previousTick = null,
    animation = 0;
  return (state, selected, duration = 0) => {
    cancelAnimationFrame(animation);
    const routeLayer = svg.querySelector(".routes"),
      cargoLayer = svg.querySelector(".cargo");
    const lines = [
      ...state.suppliers.map((s) => ({
        source: s.id,
        destination: s.warehouse,
        inbound: true,
        open: true,
      })),
      ...state.routes.map((r) => ({
        source: r.source,
        destination: r.customer,
        open: r.open,
      })),
    ];
    const fingerprint = JSON.stringify(lines);
    if (fingerprint !== previousRoutes) {
      routeLayer.innerHTML = lines
        .map((r) => {
          const d = pathFor(r.source, r.destination),
            closed = r.open === false;
          if (!d) return "";
          const descriptions =
            locations[r.source].name + " to " + locations[r.destination].name;
          return (
            '<g class="' +
            (closed ? "closed" : r.inbound ? "inbound" : "outbound") +
            '"><title>' +
            descriptions +
            (closed ? " · closed" : "") +
            '</title><path class="route-underlay" d="' +
            d +
            '"/><path class="route-line" data-route="' +
            r.source +
            "-" +
            r.destination +
            '" d="' +
            d +
            '"/></g>'
          );
        })
        .join("");
      for (const closed of routeLayer.querySelectorAll(".closed")) {
        const path = closed.querySelector(".route-line"),
          pos = path.getPointAtLength(path.getTotalLength() * 0.57);
        closed.insertAdjacentHTML(
          "beforeend",
          '<g transform="translate(' +
            pos.x +
            " " +
            pos.y +
            ')"><circle r="5.8" fill="#fff2e8" stroke="#a33f28"/><path d="m-2.2-2.2 4.4 4.4m-4.4 0 4.4-4.4" fill="none" stroke="#a33f28" stroke-width="1.4"/></g>',
        );
      }
      previousRoutes = fingerprint;
    }
    cargoLayer.innerHTML = "";
    const counts = new Map(),
      moving = [];
    const interpolate =
      duration > 0 &&
      previousTick !== null &&
      state.tick === previousTick + 1 &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    for (const sh of state.shipments) {
      const landing = interpolate && sh.arrival === state.tick;
      if (state.tick < sh.depart || (state.tick >= sh.arrival && !landing))
        continue;
      const path = routeLayer.querySelector(
        '[data-route="' + sh.source + "-" + sh.destination + '"]',
      );
      if (!path) continue;
      const key =
          sh.source + "-" + sh.destination + "-" + sh.depart + "-" + sh.arrival,
        count = counts.get(key) ?? 0;
      counts.set(key, count + 1);
      const span = sh.arrival - sh.depart;
      const end = (state.tick - sh.depart) / span,
        start = interpolate
          ? Math.max(0, (previousTick - sh.depart) / span)
          : end;
      cargoLayer.insertAdjacentHTML(
        "beforeend",
        "<g><title>" +
          escapeText(sh.quantity) +
          " units · " +
          locations[sh.destination].name +
          '</title><rect x="-6" y="-4" width="12" height="8" rx="1.8" fill="#fff" stroke="#142b23" stroke-width="1.5"/><path d="M-4-2h5v4h-5zM2 0h2v2H2z" fill="#375d48"/></g>',
      );
      moving.push({
        path,
        glyph: cargoLayer.lastElementChild,
        length: path.getTotalLength(),
        start,
        end,
        offset: count * 4,
        landing,
      });
    }
    const began = performance.now();
    const advance = (now) => {
      const progress = interpolate
        ? Math.min(1, Math.max(0, (now - began) / duration))
        : 1;
      for (const freight of moving) {
        const fraction =
          freight.start + (freight.end - freight.start) * progress;
        const point = freight.path.getPointAtLength(
          freight.length * fraction + freight.offset,
        );
        freight.glyph.setAttribute(
          "transform",
          "translate(" + point.x + " " + (point.y - 8) + ")",
        );
        if (freight.landing && progress === 1) freight.glyph.remove();
      }
      if (progress < 1 && moving.length)
        animation = requestAnimationFrame(advance);
    };
    advance(began);
    previousTick = state.tick;
    for (const n of svg.querySelectorAll(".station"))
      n.classList.toggle("selected", n.dataset.node === selected);
  };
}
