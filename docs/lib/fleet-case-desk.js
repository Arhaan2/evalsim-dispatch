export function installCaseDesk() {
  const cases = [...document.querySelectorAll(".night-case")];
  const selector = document.getElementById("case-select");
  if (!selector || !cases.length) return;

  function chooseCase(key) {
    const active = cases.find(item => item.dataset.case === key) ?? cases[0];
    selector.value = active.dataset.case;
    for (const item of cases) {
      item.hidden = item !== active;
      item.querySelectorAll("details").forEach(details => { details.open = false; });
      item.querySelector(".call-status").textContent = "";
      item.querySelectorAll("[data-pick]").forEach(button => button.setAttribute("aria-pressed", "false"));
    }
  }

  document.querySelector(".case-list").hidden = false;
  for (const item of cases) {
    const controls = item.querySelector(".call-row");
    const choices = [...controls.querySelectorAll("[data-pick]")];
    controls.hidden = false;
    controls.addEventListener("click", event => {
      const choice = event.target.closest("[data-pick]");
      if (!choices.includes(choice)) return;
      for (const button of choices) button.setAttribute("aria-pressed", String(button === choice));
      const other = choices.find(button => button !== choice);
      const net = Number(choice.dataset.net);
      const difference = net - Number(other.dataset.net);
      const comparison = difference === 0 ? "the same earnings as the other choice" :
        Math.abs(difference) + (difference > 0 ? " more" : " fewer") + " than the other choice";
      item.querySelector(".call-status").textContent = choice.dataset.feedback ?? ("Your choice earned " + net + " net credits through Friday, " + comparison + ".");
      item.querySelector(".outcome").open = true;
    });
  }
  selector.addEventListener("change", () => chooseCase(selector.value));
  chooseCase(new URLSearchParams(location.search).get("case"));
}
