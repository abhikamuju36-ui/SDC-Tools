"use client";

import { useEffect, useState } from "react";
import { TOOLBAR_BTN, TOOLBAR_BTN_ACTIVE, TOOLBAR_BTN_NEUTRAL } from "@/components/ui/classnames";

// Toolbar toggle for the Projects grid: show or hide the "/actual" hours beside
// each quoted value. Toggles a body class the grid CSS keys off, persisted in
// localStorage. Quoted hours (the editable inputs) always stay visible; only the
// actual suffix is shown/hidden. The over/under cell coloring is unaffected.
export function ShowActualsToggle() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("quoted-show-actuals");
    const v = saved === null ? false : saved === "1";
    setShow(v);
    document.body.classList.toggle("hide-actuals", !v);
  }, []);

  const toggle = () => {
    const v = !show;
    setShow(v);
    localStorage.setItem("quoted-show-actuals", v ? "1" : "0");
    document.body.classList.toggle("hide-actuals", !v);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      title="Show or hide actual hours next to quoted in each cell"
      className={`${TOOLBAR_BTN} ${show ? TOOLBAR_BTN_ACTIVE : TOOLBAR_BTN_NEUTRAL}`}
    >
      {show ? "Actuals: On" : "Actuals: Off"}
    </button>
  );
}
