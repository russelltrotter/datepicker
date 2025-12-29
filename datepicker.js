(() => {
  // ===== Utilities =====
  const pad2 = (n) => String(n).padStart(2, "0");
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const diffDays = (a, b) => Math.round((startOfDay(b) - startOfDay(a)) / 86400000);
  const sameDay = (a, b) =>
    a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const toISO = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const fromISO = (s) => {
    const [y, m, dd] = s.split("-").map(Number);
    return new Date(y, m - 1, dd);
  };
  const formatHuman = (d) => d.toLocaleDateString(undefined, { weekday: "short", day: "2-digit", month: "short", year: "numeric" });

  // ===== Config defaults =====
  const DEFAULT_CONFIG = {
    // Booking window: arrival date must be between minDate and (minDate + maxStartAdvanceDays)
    maxStartAdvanceDays: 270,

    // Stay length
    minNights: 2,
    maxNights: 14,

    // Blocked dates / ranges (JSON array)
    // Supported:
    //  - { "date": "YYYY-MM-DD", "label": "Closed" }
    //  - { "start": "YYYY-MM-DD", "end": "YYYY-MM-DD", "label": "Full booked" }  (inclusive)
    blocked: [
      // Your requested ranges (inclusive) — adjust years as needed:
      { start: "2026-11-01", end: "2026-12-31", label: "Closed" },
      { start: "2027-01-01", end: "2027-03-31", label: "Closed" },

      // Examples:
      // { date: "2026-08-15", label: "Full" },
      // { start: "2026-07-10", end: "2026-07-17", label: "Full booked" }
    ],

    // Optional: restrict arrivals to a changeover day (0=Sun..6=Sat)
    // changeoverDay: 5,

    // Display mode: 'popup' (default) or 'inline' (always visible)
    displayMode: "popup",

    // Responsive width: if true, calendar adapts to container width
    // If false or undefined, uses fixed max-width
    responsiveWidth: false,
  };

  const normalizeConfig = (overrides = {}) => {
    const minDateInput = overrides.minDate ?? startOfDay(new Date());
    const minDate = startOfDay(new Date(minDateInput));
    const blocked = Array.isArray(overrides.blocked) ? overrides.blocked : DEFAULT_CONFIG.blocked;

    return {
      minDate,
      maxStartAdvanceDays: overrides.maxStartAdvanceDays ?? DEFAULT_CONFIG.maxStartAdvanceDays,
      minNights: overrides.minNights ?? DEFAULT_CONFIG.minNights,
      maxNights: overrides.maxNights ?? DEFAULT_CONFIG.maxNights,
      blocked,
      changeoverDay: Object.prototype.hasOwnProperty.call(overrides, "changeoverDay")
        ? overrides.changeoverDay
        : DEFAULT_CONFIG.changeoverDay,
      displayMode: overrides.displayMode ?? DEFAULT_CONFIG.displayMode,
      responsiveWidth: overrides.responsiveWidth ?? DEFAULT_CONFIG.responsiveWidth,
    };
  };

  // Expand blocked JSON into a Map of ISO date -> label (first label wins)
  const buildBlockedMap = (blockedArr) => {
    const map = new Map();
    for (const item of blockedArr || []) {
      const label = (item.label || "Blocked").trim();

      if (item.date) {
        if (!map.has(item.date)) map.set(item.date, label);
        continue;
      }

      if (item.start && item.end) {
        let d = startOfDay(fromISO(item.start));
        const end = startOfDay(fromISO(item.end));
        while (d <= end) {
          const iso = toISO(d);
          if (!map.has(iso)) map.set(iso, label);
          d = addDays(d, 1);
        }
      }
    }
    return map;
  };

  const initLodgeDateRangePicker = (root, overrides = {}) => {
    if (!root) return;
    
    // Prevent double auto-initialization (when no overrides provided)
    // Manual initialization (with overrides) is always allowed
    const isManualInit = Object.keys(overrides).length > 0;
    if (!isManualInit && root.hasAttribute("data-ldr-initialized")) {
      return;
    }
    
    // For manual init on already-initialized element, remove the flag to allow re-init
    if (isManualInit && root.hasAttribute("data-ldr-initialized")) {
      root.removeAttribute("data-ldr-initialized");
    }
    
    root.setAttribute("data-ldr-initialized", "true");

    const CONFIG = normalizeConfig(overrides);
    const BLOCKED = buildBlockedMap(CONFIG.blocked);

    const elStart = root.querySelector("[data-ldr-start]");
    const elEnd = root.querySelector("[data-ldr-end]");
    const elStartISO = root.querySelector("[data-ldr-start-iso]");
    const elEndISO = root.querySelector("[data-ldr-end-iso]");
    const elNights = root.querySelector("[data-ldr-nights]");
    const elMeta = root.querySelector("[data-ldr-meta]");
    const panel = root.querySelector("[data-ldr-panel]");
    const calwrap = root.querySelector("[data-ldr-calwrap]");
    const title = root.querySelector("[data-ldr-title]");
    const btnPrev = root.querySelector("[data-ldr-prev]");
    const btnNext = root.querySelector("[data-ldr-next]");
    const btnClear = root.querySelector("[data-ldr-clear]");
    const btnClose = root.querySelector("[data-ldr-close]");

    // Validate required elements exist
    if (!elStart || !elEnd || !elStartISO || !elEndISO || !elNights || !elMeta || !panel || !calwrap || !title || !btnPrev || !btnNext || !btnClear || !btnClose) {
      console.error("LodgeDatePicker: Missing required DOM elements");
      return;
    }

    let viewMonth = new Date(CONFIG.minDate.getFullYear(), CONFIG.minDate.getMonth(), 1);
    let start = null;
    let end = null;

    const maxStartDate = addDays(CONFIG.minDate, CONFIG.maxStartAdvanceDays);

    // Set display mode class on root
    const isInline = CONFIG.displayMode === "inline";
    if (isInline) {
      root.classList.add("ldr--inline");
      panel.hidden = false; // Always visible in inline mode
    } else {
      root.classList.add("ldr--popup");
    }

    // Set responsive width class if enabled
    if (CONFIG.responsiveWidth) {
      root.classList.add("ldr--responsive");
    }

    // Position panel intelligently based on viewport (only for popup mode)
    const positionPanel = () => {
      if (panel.hidden || isInline) return;

      const rect = root.getBoundingClientRect();
      // Use estimated panel dimensions (720px width, ~400px height typical)
      const estimatedPanelWidth = Math.min(720, window.innerWidth - 24);
      const estimatedPanelHeight = 400;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const margin = 12;

      // Reset positioning
      panel.removeAttribute("data-position");

      const wouldOverflowRight = rect.left + estimatedPanelWidth > viewportWidth - margin;
      const wouldOverflowBottom = rect.bottom + estimatedPanelHeight > viewportHeight - margin;

      // Set positioning attribute
      if (wouldOverflowRight && wouldOverflowBottom) {
        panel.setAttribute("data-position", "right-top");
      } else if (wouldOverflowRight) {
        panel.setAttribute("data-position", "right");
      } else if (wouldOverflowBottom) {
        panel.setAttribute("data-position", "top");
      }
    };

    // Open / close (only for popup mode)
    const open = () => {
      if (isInline) return; // No-op in inline mode
      panel.hidden = false;
      render();
      // Position after render so we have accurate dimensions
      requestAnimationFrame(() => {
        positionPanel();
      });
    };
    const close = () => {
      if (isInline) return; // No-op in inline mode
      panel.hidden = true;
    };

    // Close on outside click - store handler for cleanup (only for popup mode)
    const handleOutsideClick = (e) => {
      if (!isInline && !root.contains(e.target)) close();
    };
    if (!isInline) {
      document.addEventListener("mousedown", handleOutsideClick);
    }

    // Close on Escape key (only for popup mode)
    const handleEscape = (e) => {
      if (!isInline && e.key === "Escape" && !panel.hidden) {
        close();
        elStart.focus();
      }
    };
    if (!isInline) {
      document.addEventListener("keydown", handleEscape);
    }

    // Close and reposition on scroll/resize (only for popup mode)
    const handleScroll = () => {
      if (!isInline && !panel.hidden) {
        positionPanel();
      }
    };
    const handleResize = () => {
      if (!isInline && !panel.hidden) {
        positionPanel();
      }
    };
    if (!isInline) {
      window.addEventListener("scroll", handleScroll, true);
      window.addEventListener("resize", handleResize);
    }

    // Only add click handlers for popup mode
    if (!isInline) {
      elStart.addEventListener("click", open);
      elEnd.addEventListener("click", open);
      btnClose.addEventListener("click", close);
    } else {
      // In inline mode, inputs are still readonly but not clickable for opening
      elStart.style.cursor = "default";
      elEnd.style.cursor = "default";
    }

    btnClear.addEventListener("click", () => {
      start = null;
      end = null;
      syncOutputs();
      render();
      elStart.focus();
    });

    btnPrev.addEventListener("click", () => {
      viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1);
      render();
    });

    btnNext.addEventListener("click", () => {
      viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1);
      render();
    });

    // Rules
    const blockedLabel = (d) => BLOCKED.get(toISO(d)) || null;
    const isBlocked = (d) => !!blockedLabel(d);
    const isBeforeMin = (d) => startOfDay(d) < startOfDay(CONFIG.minDate);
    const isAfterMaxStart = (d) => startOfDay(d) > startOfDay(maxStartDate);
    const matchesChangeover = (d) => (typeof CONFIG.changeoverDay === "number" ? d.getDay() === CONFIG.changeoverDay : true);

    // Arrival must be within [minDate, maxStartDate], not blocked, and match changeover if set.
    const isSelectableArrival = (d) => !isBeforeMin(d) && !isAfterMaxStart(d) && !isBlocked(d) && matchesChangeover(d);

    const isSelectableDeparture = (d) => {
      if (!start) return false;
      // Departure must be after start (nights >= 1), so isBeforeMin check is redundant but kept for safety
      if (isBlocked(d) || isBeforeMin(d)) return false;

      const nights = diffDays(start, d);
      if (nights < CONFIG.minNights) return false;
      if (CONFIG.maxNights && nights > CONFIG.maxNights) return false;

      // ensure NO blocked day is inside the stay (arrival date through day before departure)
      for (let i = 0; i < nights; i++) {
        if (isBlocked(addDays(start, i))) return false;
      }
      return true;
    };

    // Helper to get departure validation error message
    const getDepartureError = (d) => {
      if (!start) return null;
      const bl = blockedLabel(d);
      if (bl) return `That departure date is unavailable: ${bl}.`;
      if (isBeforeMin(d)) return `Departure must be on or after ${formatHuman(CONFIG.minDate)}.`;
      const nights = diffDays(start, d);
      if (nights < CONFIG.minNights) return `Stay must be at least ${CONFIG.minNights} night${CONFIG.minNights === 1 ? "" : "s"}.`;
      if (CONFIG.maxNights && nights > CONFIG.maxNights) return `Stay cannot exceed ${CONFIG.maxNights} night${CONFIG.maxNights === 1 ? "" : "s"}.`;
      // Check for blocked days in range
      for (let i = 0; i < nights; i++) {
        const dayInRange = addDays(start, i);
        const blockedInRange = blockedLabel(dayInRange);
        if (blockedInRange) return `Stay includes unavailable date: ${formatHuman(dayInRange)} (${blockedInRange}).`;
      }
      return null;
    };

    // Render helpers
    const monthName = (d) => d.toLocaleDateString(undefined, { month: "long", year: "numeric" });

    const buildMonth = (firstOfMonth) => {
      const monthEl = document.createElement("div");
      monthEl.className = "ldr__month";

      const mt = document.createElement("div");
      mt.className = "ldr__monthTitle";
      mt.textContent = monthName(firstOfMonth);
      monthEl.appendChild(mt);

      const dow = document.createElement("div");
      dow.className = "ldr__dow";
      ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].forEach((t) => {
        const d = document.createElement("div");
        d.textContent = t;
        dow.appendChild(d);
      });
      monthEl.appendChild(dow);

      const grid = document.createElement("div");
      grid.className = "ldr__grid";

      const firstDay = new Date(firstOfMonth.getFullYear(), firstOfMonth.getMonth(), 1);
      const lastDay = new Date(firstOfMonth.getFullYear(), firstOfMonth.getMonth() + 1, 0);

      const mondayIndex = (day) => (day === 0 ? 6 : day - 1);
      const leading = mondayIndex(firstDay.getDay());
      const totalDays = lastDay.getDate();

      // prev month filler
      const prevLast = new Date(firstOfMonth.getFullYear(), firstOfMonth.getMonth(), 0).getDate();
      for (let i = leading; i > 0; i--) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "ldr__day ldr__day--mute";
        b.disabled = true;
        b.textContent = String(prevLast - i + 1);
        grid.appendChild(b);
      }

      // current month days
      for (let day = 1; day <= totalDays; day++) {
        const d = new Date(firstOfMonth.getFullYear(), firstOfMonth.getMonth(), day);
        const b = document.createElement("button");
        b.type = "button";
        b.className = "ldr__day";
        b.textContent = String(day);

        const today = startOfDay(new Date());
        if (sameDay(d, today)) b.classList.add("ldr__day--today");

        // Disabled logic depends on stage
        let disabled = false;
        if (!start) {
          disabled = !isSelectableArrival(d);
        } else if (start && !end) {
          disabled = !isSelectableDeparture(d);
        } else {
          // completed range → allow starting new selection
          disabled = !isSelectableArrival(d);
        }
        if (disabled) b.disabled = true;

        // range visuals
        if (start && sameDay(d, start)) b.classList.add("ldr__day--start");
        if (end && sameDay(d, end)) b.classList.add("ldr__day--end");
        if (start && end && startOfDay(d) > startOfDay(start) && startOfDay(d) < startOfDay(end)) {
          b.classList.add("ldr__day--inrange");
        }

        // badge for blocked label (and tooltip)
        const bl = blockedLabel(d);
        if (bl) {
          const badge = document.createElement("span");
          badge.className = "ldr__badge ldr__badge--blocked";
          badge.textContent = bl;
          b.title = bl;
          b.appendChild(badge);
        } else if (!start && typeof CONFIG.changeoverDay === "number" && d.getDay() === CONFIG.changeoverDay) {
          const badge = document.createElement("span");
          badge.className = "ldr__badge";
          badge.textContent = "↺";
          b.appendChild(badge);
        }

        b.addEventListener("click", () => onPick(d));
        grid.appendChild(b);
      }

      // trailing blanks
      const cells = grid.children.length;
      const trailing = (7 - (cells % 7)) % 7;
      for (let i = 0; i < trailing; i++) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "ldr__day ldr__day--mute";
        b.disabled = true;
        b.textContent = "";
        grid.appendChild(b);
      }

      monthEl.appendChild(grid);
      return monthEl;
    };

    const onPick = (d) => {
      d = startOfDay(d);

      // Helpful message if clicking a blocked day
      const bl = blockedLabel(d);

      if (!start || (start && end)) {
        if (!isSelectableArrival(d)) {
          if (bl) elMeta.textContent = `That arrival date is unavailable: ${bl}.`;
          else if (isAfterMaxStart(d)) elMeta.textContent = `Arrival must be within ${CONFIG.maxStartAdvanceDays} days.`;
          return;
        }
        start = d;
        end = null;
      } else {
        if (!isSelectableDeparture(d)) {
          const errorMsg = getDepartureError(d);
          if (errorMsg) elMeta.textContent = errorMsg;
          return;
        }
        end = d;
      }

      viewMonth = new Date(d.getFullYear(), d.getMonth(), 1);
      syncOutputs();
      render();
    };

    const syncOutputs = () => {
      if (!start) {
        elStart.value = "";
        elEnd.value = "";
        elStartISO.value = "";
        elEndISO.value = "";
        elNights.value = "";
        elMeta.textContent = `Select arrival (up to ${CONFIG.maxStartAdvanceDays} days in advance).`;
        root.dispatchEvent(new CustomEvent("ldr:change", { detail: { start: null, end: null, nights: null } }));
        return;
      }

      elStart.value = formatHuman(start);
      elStartISO.value = toISO(start);

      if (!end) {
        elEnd.value = "";
        elEndISO.value = "";
        elNights.value = "";
        elMeta.textContent = `Select departure (${CONFIG.minNights}–${CONFIG.maxNights} nights).`;
        root.dispatchEvent(new CustomEvent("ldr:change", { detail: { start: toISO(start), end: null, nights: null } }));
        return;
      }

      const nights = diffDays(start, end);
      elEnd.value = formatHuman(end);
      elEndISO.value = toISO(end);
      elNights.value = String(nights);
      elMeta.textContent = `${nights} night${nights === 1 ? "" : "s"} selected.`;

      root.dispatchEvent(new CustomEvent("ldr:change", { detail: { start: toISO(start), end: toISO(end), nights } }));
    };

    const render = () => {
      const nextMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1);
      title.textContent = `${monthName(viewMonth)}  ·  ${monthName(nextMonth)}`;

      // prevent going earlier than minDate month
      const minMonth = new Date(CONFIG.minDate.getFullYear(), CONFIG.minDate.getMonth(), 1);
      btnPrev.disabled = viewMonth <= minMonth;

      // prevent going beyond maxStartDate month
      const maxMonth = new Date(maxStartDate.getFullYear(), maxStartDate.getMonth(), 1);
      const maxViewMonth = new Date(maxMonth.getFullYear(), maxMonth.getMonth() - 1, 1); // Can view one month before max
      btnNext.disabled = viewMonth >= maxViewMonth;

      calwrap.innerHTML = "";
      calwrap.appendChild(buildMonth(viewMonth));
      calwrap.appendChild(buildMonth(nextMonth));

      // Reposition panel after render if open (only for popup mode)
      if (!isInline && !panel.hidden) {
        requestAnimationFrame(() => {
          positionPanel();
        });
      }
    };

    // Pre-fill from hidden ISO fields (optional) - validate against config
    if (elStartISO.value) {
      const preStart = fromISO(elStartISO.value);
      if (isSelectableArrival(preStart)) {
        start = preStart;
      } else {
        // Invalid pre-filled date, clear it
        elStartISO.value = "";
      }
    }
    if (elEndISO.value && start) {
      const preEnd = fromISO(elEndISO.value);
      if (isSelectableDeparture(preEnd)) {
        end = preEnd;
      } else {
        // Invalid pre-filled date, clear it
        elEndISO.value = "";
      }
    } else if (elEndISO.value && !start) {
      // End date without start date is invalid
      elEndISO.value = "";
    }

    syncOutputs();
    
    // Initial render for inline mode
    if (isInline) {
      render();
    }
  };

  // Auto-init on page load for elements with [data-ldr] but not [data-ldr-no-auto]
  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("[data-ldr]:not([data-ldr-no-auto])").forEach((root) => {
      initLodgeDateRangePicker(root);
    });
  });

  // Expose helper for manual init if needed elsewhere
  window.LodgeDatePicker = {
    init: initLodgeDateRangePicker,
    defaultConfig: DEFAULT_CONFIG,
  };
})();
