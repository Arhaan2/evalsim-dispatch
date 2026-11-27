import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const docs = new URL("../docs/", import.meta.url);
function html(file) {
  return readFileSync(new URL(file,docs),"utf8");
}
function localLinks(source) {
  const hrefs = [...source.matchAll(/\bhref="([^"]+)"/g)].map(match=>match[1]);
  return hrefs.filter(href=>href.startsWith("./") || href.startsWith("#"));
}
function checkTarget(href,from) {
  const target = new URL(href,new URL(from,docs));
  if (target.pathname.endsWith("/")) target.pathname+="index.html";
  const anchor = decodeURIComponent(target.hash.slice(1));
  target.hash="";
  if (!target.pathname.endsWith(".html")) return;
  const content=readFileSync(target,"utf8");
  if (anchor) assert(content.includes('id="'+anchor+'"'),from+" links to missing section "+href);
}
test("research library reaches each published desk and its linked sections without JavaScript",()=>{
  const source=html("studies.html");
  const links=localLinks(source);
  links.forEach(href=>checkTarget(href,"studies.html"));
  const studies=["switchcost","moverecall","longmove","shortdefault","longrepair","closure","loss","uncertainty","override","overnight","fleetweek","waitcost","loadchoice","lastslot","tariff","paid","booking","survey","rally","trust","closes","turns","drift",
    "reserve","cutoff","index","language-model"];
  for (const name of studies) {
    assert(links.some(href=>href.split("#")[0]==="./"+name+".html"),name+" missing from study library");
    assert(localLinks(html(name+".html")).some(href=>href.split("#")[0]==="./studies.html"),name+" missing a return path");
  }
  for (const page of ["loadchoice.html","waitcost.html","fleetweek.html","overnight.html","override.html","uncertainty.html","loss.html","closure.html","longrepair.html","shortdefault.html","longmove.html","moverecall.html","switchcost.html"]) localLinks(html(page)).forEach(href=>checkTarget(href,page));
});
