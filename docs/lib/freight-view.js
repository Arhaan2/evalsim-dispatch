export const $ = id => document.getElementById(id);
export const num = (n, digits = 1) => n.toLocaleString("en-US", { maximumFractionDigits: digits });
export const signed = n => (n > 0 ? "+" : "") + num(n, 2);
export const text = (tag, value) => Object.assign(document.createElement(tag), { textContent: value });

export function cell(row, tag, value, scope) {
  const el = text(tag, value);
  if (scope) el.scope = scope;
  row.append(el);
  return el;
}

export function table(headers, caption) {
  const el = document.createElement("table");
  el.createCaption().textContent = caption;
  el.caption.className = "sr";
  const row = el.createTHead().insertRow();
  headers.forEach(header => cell(row, "th", header, "col"));
  return el;
}

export function scrollTable(table) {
  const frame = document.createElement("div");
  frame.className = "grid-scroll";
  frame.tabIndex = 0;
  frame.setAttribute("role", "region");
  frame.setAttribute("aria-label", table.caption.textContent);
  frame.append(table);
  return frame;
}

export function shiftUrl(settings, actions = [], hash = "") {
  const url = new URL(location.href);
  url.search = "";
  url.searchParams.set("family", settings.family);
  url.searchParams.set("seed", String(settings.seed));
  if (actions.length) url.searchParams.set("actions", actions.join(","));
  url.hash = hash;
  return url;
}

export function renderOffer(o) {
  $("wave").textContent = o.done ? "Shift complete" : "Wave " + (o.wave + 1) + " of " + o.horizon;
  $("offer-heading").textContent = o.done ? "Final contribution" : o.offer.lane + " load";
  $("net-offer").textContent = o.done ? o.net : o.offer.net;
  $("amount-label").textContent = o.done ? "net credits earned" : "net credits";
  $("offer-detail").textContent = o.done
    ? "All " + o.horizon + " booking windows have closed."
    : o.offer.revenue + " freight revenue less " + o.offer.cost + " handling cost.";
  const later = o.forecast.length;
  $("capacity-note").textContent = !o.done && o.slots && later
    ? "Booking now leaves " + (o.slots - 1) + (o.slots === 2 ? " slot" : " slots") + " for " + later + (later === 1 ? " later offer." : " later offers.")
    : "";
  $("slot-count").textContent = o.slots + " of " + o.capacity + " slots open";
  $("slot-tiles").replaceChildren(...Array.from({length: o.capacity}, (_,i) => {
    const tile = document.createElement("span");
    if (i < o.slots) tile.className = "open";
    return tile;
  }));
  $("accept").hidden = o.done;
  $("accept").disabled = !o.slots;
  $("pass").hidden = o.done;
  $("pass").textContent = o.slots ? "Pass" : "Finish shift";
  $("again").hidden = !o.done;
  $("reset").hidden = !o.wave || o.done;
}

export function renderForecast(o, note) {
  $("forecast").replaceChildren();
  $("forecast-table").hidden = !o.forecast.length;
  $("forecast-note").textContent = note;
  o.forecast.forEach((forecast, i) => {
    const row = $("forecast").insertRow();
    cell(row, "th", o.wave + i + 2, "row");
    cell(row, "td", forecast.low === forecast.high ? String(forecast.low) : forecast.low + " / " + forecast.high);
    cell(row, "td", forecast.low === forecast.high ? "Fixed" : num(100 * forecast.highChance) + "%");
    cell(row, "td", num(forecast.mean, 2));
  });
}
