import assert from "node:assert/strict";

export function checkNotices(frames,original,profile) {
  for(const [t,o] of frames.entries()) {
    assert.equal(o.epoch,t);
    const {incident,...underlying}=o;
    assert.deepEqual(underlying,original[t]);
    assert.deepEqual(Object.keys(incident).sort(),["depot","start","status","update"]);
  }
  if (profile===null) {
    assert(frames.every(o=>o.incident.status==="clear" && o.incident.depot===null && o.incident.start===null && o.incident.update===null));
    return;
  }
  const notices=frames.map(o=>o.incident), first=notices.findIndex(i=>i.status==="warning");
  assert(first>=0);
  const {start,depot}=notices[first];
  assert.equal(start,first+1);
  assert([0,1,2].includes(depot));
  assert(profile.starts.includes(start));
  const closed=notices.filter(i=>i.status==="closed").length;
  assert(profile.durations.some(d=>Math.min(10-start,d)===closed));
  const update=closed>1 ? notices[start+1].update : null;
  if (closed>1) assert(["on-track","delayed"].includes(update));
  for(const [t,i] of notices.entries()) {
    const status=t<first ? "clear" : t===first ? "warning" : t<start+closed ? "closed" : "reopened";
    assert.deepEqual(i,{status,depot:t<first?null:depot,start:t<first?null:start,update:t>start?update:null});
  }
}

// Filter the original public legal menu with just the description of closure:
// cargo needs an open depot at both ends. Empty trucks may exit or stay.
export function openMoves(obs,all) {
  if (obs.incident.status!=="closed") return all;
  const closed=obs.incident.depot;
  return all.filter(a=>a.moves.every((move,k)=>{
    if (move==="W") return true;
    if (a.positions[k]===closed) return false;
    return move[0]==="E" || obs.positions[k]!==closed;
  }));
}
