const $ = (id) => document.getElementById(id);

let rebarLayers = [
  { z: 50, bars: 2 },
  { z: 250, bars: 2 },
  { z: 450, bars: 2 }
];

let demandRows = [
  { n: 560.2, m: 384.6 }
];

const inputs = [
  "width", "height", "barDiameter", "fck", "fyk", "gammaC", "gammaS", "etaCc", "kTc", "es",
  "epsCu", "lambdaBlock", "neutralAxis", "bottomStrain", "curveSamples"
];

function numberValue(id) {
  return Number($(id).value);
}

function material() {
  const fck = numberValue("fck");
  const fyk = numberValue("fyk");
  const gammaC = numberValue("gammaC");
  const gammaS = numberValue("gammaS");
  const etaCc = numberValue("etaCc");
  const kTc = numberValue("kTc");
  const es = numberValue("es");
  return {
    fck,
    fyk,
    gammaC,
    gammaS,
    etaCc,
    kTc,
    es,
    epsCu: numberValue("epsCu"),
    lambdaBlock: numberValue("lambdaBlock"),
    fcd: etaCc * kTc * fck / gammaC,
    fyd: fyk / gammaS,
    get epsY() {
      return this.fyd / es * 1000;
    }
  };
}

function section() {
  const barDiameter = numberValue("barDiameter");
  const barArea = Math.PI * barDiameter ** 2 / 4;
  const layers = rebarLayers
    .map((layer, index) => ({
      id: index + 1,
      z: Number(layer.z),
      bars: Math.max(1, Math.round(Number(layer.bars))),
      area: Math.max(1, Math.round(Number(layer.bars))) * barArea
    }))
    .sort((a, b) => a.z - b.z);
  return {
    width: numberValue("width"),
    height: numberValue("height"),
    barDiameter,
    barArea,
    layers,
    positions: layers.map((layer) => layer.z),
    totalSteelArea: layers.reduce((sum, layer) => sum + layer.area, 0)
  };
}

function steelStress(strainPerMille, mat) {
  const elastic = mat.es * strainPerMille / 1000;
  return Math.max(-mat.fyd, Math.min(mat.fyd, elastic));
}

function calculatePoint(sec, mat, options) {
  if (options.pureCompression) {
    const steelLayers = sec.positions.map((z, i) => layerResult(sec, mat, i, z, mat.epsCu, mat.fyd));
    const cc = mat.fcd * sec.width * sec.height / 1000;
    return assemble("pure compression", null, sec.height, cc, 0, steelLayers, sec, mat);
  }

  if (options.pureTension) {
    const steelLayers = sec.positions.map((z, i) => layerResult(sec, mat, i, z, -mat.epsY, -mat.fyd));
    return assemble("pure tension", null, 0, 0, 0, steelLayers, sec, mat);
  }

  let x = options.neutralAxis;
  if (options.bottomStrain !== undefined && options.bottomStrain !== null) {
    const d1 = sec.positions[sec.positions.length - 1];
    x = d1 * mat.epsCu / (mat.epsCu + options.bottomStrain);
  }

  const a = Math.min(mat.lambdaBlock * x, sec.height);
  const cc = mat.fcd * sec.width * a / 1000;
  const concreteLever = (sec.height / 2 - a / 2) / 1000;
  const steelLayers = sec.positions.map((z, i) => {
    const strain = mat.epsCu * (x - z) / x;
    return layerResult(sec, mat, i, z, strain, steelStress(strain, mat));
  });
  return assemble("neutral axis", x, a, cc, concreteLever, steelLayers, sec, mat);
}

function layerResult(sec, mat, index, z, strain, stress) {
  const layer = sec.layers[index];
  const area = layer.area;
  const force = area * stress / 1000;
  const lever = (sec.height / 2 - z) / 1000;
  return {
    layer: index + 1,
    z,
    bars: layer.bars,
    area,
    strain,
    stress,
    force,
    lever,
    moment: force * lever
  };
}

function assemble(mode, x, a, concreteForce, concreteLever, steelLayers, sec, mat) {
  const steelForce = steelLayers.reduce((sum, layer) => sum + layer.force, 0);
  const steelMoment = steelLayers.reduce((sum, layer) => sum + layer.moment, 0);
  const concreteMoment = concreteForce * concreteLever;
  return {
    mode,
    x,
    a,
    concreteForce,
    concreteLever,
    concreteMoment,
    steelLayers,
    n: concreteForce + steelForce,
    m: concreteMoment + steelMoment,
    sec,
    mat
  };
}

function activePoint(sec, mat) {
  const mode = document.querySelector("input[name='pointMode']:checked").value;
  if (mode === "strain") {
    return calculatePoint(sec, mat, { bottomStrain: numberValue("bottomStrain") });
  }
  if (mode === "compression") {
    return calculatePoint(sec, mat, { pureCompression: true });
  }
  if (mode === "tension") {
    return calculatePoint(sec, mat, { pureTension: true });
  }
  return calculatePoint(sec, mat, { neutralAxis: numberValue("neutralAxis") });
}

function curvePoints(sec, mat) {
  const samples = Math.max(16, Math.round(numberValue("curveSamples")));
  const bottom = sec.positions[sec.positions.length - 1];
  const minX = Math.max(1, 0.05 * bottom);
  const maxX = 2.5 * sec.height;
  const points = [calculatePoint(sec, mat, { pureTension: true })];
  for (let i = 0; i < samples; i += 1) {
    const ratio = i / Math.max(1, samples - 1);
    const x = minX * (maxX / minX) ** ratio;
    points.push(calculatePoint(sec, mat, { neutralAxis: x }));
  }
  points.push(calculatePoint(sec, mat, { pureCompression: true }));
  return points;
}

function fmt(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return Number(value).toFixed(digits);
}

function update() {
  const sec = section();
  const mat = material();
  const point = activePoint(sec, mat);
  const curve = curvePoints(sec, mat);
  const demands = demandPoints();
  const demandChecks = demands.map((demand) => checkDemandInsideCurve(curve, demand));
  const demandSummary = summarizeDemandChecks(demandChecks);
  const warnings = validate(sec, mat, point);

  $("fcdOut").textContent = `${fmt(mat.fcd, 2)} MPa`;
  $("fydOut").textContent = `${fmt(mat.fyd, 1)} MPa`;
  $("epsYOut").textContent = `${fmt(mat.epsY, 3)} per mille`;
  $("asOut").textContent = `${fmt(sec.totalSteelArea, 1)} mm2 total`;

  $("nOut").textContent = `${fmt(point.n, 1)} kN`;
  $("mOut").textContent = `${fmt(point.m, 1)} kNm`;
  $("xOut").textContent = point.x ? `${fmt(point.x, 1)} mm` : "-";
  $("aOut").textContent = `${fmt(point.a, 1)} mm`;
  $("ccOut").textContent = `${fmt(point.concreteForce, 1)} kN`;
  renderDemandSummary(demandSummary);
  updateDemandStatuses(demandChecks);
  $("warningBox").textContent = warnings.join(" ");
  $("warningBox").hidden = warnings.length === 0;

  renderSection(sec);
  renderTable(point);
  renderChart(curve, point, demands, demandChecks);
  renderCsv(curve);
  updateModeVisibility();
}

function demandPoints() {
  return demandRows.map((row) => {
    const n = Number(row.n);
    const m = Number(row.m);
    return {
      n,
      m,
      absM: Math.abs(m)
    };
  });
}

function checkDemandInsideCurve(curve, demand) {
  const m = demand.absM;
  const intersections = [];
  for (let i = 0; i < curve.length - 1; i += 1) {
    const p1 = { m: Math.abs(curve[i].m), n: curve[i].n };
    const p2 = { m: Math.abs(curve[i + 1].m), n: curve[i + 1].n };
    const mMin = Math.min(p1.m, p2.m);
    const mMax = Math.max(p1.m, p2.m);
    if (m < mMin - 1e-9 || m > mMax + 1e-9 || Math.abs(p2.m - p1.m) < 1e-9) continue;
    const ratio = (m - p1.m) / (p2.m - p1.m);
    intersections.push(p1.n + ratio * (p2.n - p1.n));
  }

  const unique = [...new Set(intersections.map((value) => fmt(value, 6)))].map(Number);
  if (unique.length < 2) {
    return {
      inside: false,
      reason: "MEd is outside the plotted moment capacity range.",
      nMin: null,
      nMax: null,
      utilization: Infinity
    };
  }

  const nMin = Math.min(...unique);
  const nMax = Math.max(...unique);
  const inside = demand.n >= nMin - 1e-6 && demand.n <= nMax + 1e-6;
  const compressionUtil = demand.n >= 0 && nMax > 0 ? demand.n / nMax : 0;
  const tensionUtil = demand.n < 0 && nMin < 0 ? Math.abs(demand.n / nMin) : 0;
  return {
    inside,
    reason: inside ? "Demand point is inside the interaction envelope." : "Demand point is outside the interaction envelope.",
    nMin,
    nMax,
    utilization: Math.max(compressionUtil, tensionUtil)
  };
}

function summarizeDemandChecks(checks) {
  const total = checks.length;
  if (total === 0) {
    return {
      inside: false,
      insideCount: 0,
      total: 0,
      maxUtilization: null
    };
  }
  const insideCount = checks.filter((check) => check.inside).length;
  const utilizations = checks.map((check) => check.utilization).filter(Number.isFinite);
  return {
    inside: insideCount === total,
    insideCount,
    total,
    maxUtilization: utilizations.length ? Math.max(...utilizations) : null
  };
}

function renderDemandSummary(summary) {
  const el = $("demandSummary");
  if (summary.total === 0) {
    el.classList.remove("is-ok", "is-fail");
    el.innerHTML = "<strong>No design actions</strong><span>Add at least one row.</span>";
    return;
  }
  el.classList.toggle("is-ok", summary.inside);
  el.classList.toggle("is-fail", !summary.inside);
  const utilization = summary.maxUtilization !== null
    ? `Max util. ${fmt(summary.maxUtilization * 100, 1)}%`
    : "Max util. -";
  el.innerHTML = `<strong>${summary.inside ? "All inside curve" : "Outside curve"}</strong><span>${summary.insideCount} of ${summary.total} cases inside</span><span>${utilization}</span>`;
}

function updateDemandStatuses(checks) {
  $("demandList").querySelectorAll(".demand-row").forEach((row) => {
    const index = Number(row.dataset.demandIndex);
    const status = row.querySelector("[data-demand-status]");
    const check = checks[index];
    if (!status) return;
    if (!check) {
      status.textContent = "-";
      status.classList.remove("is-ok", "is-fail");
      return;
    }
    status.classList.toggle("is-ok", check.inside);
    status.classList.toggle("is-fail", !check.inside);
    const range = check.nMin === null
      ? "No capacity range"
      : `Capacity at MEd: ${fmt(check.nMin, 1)} to ${fmt(check.nMax, 1)} kN`;
    const utilization = Number.isFinite(check.utilization)
      ? `Util. ${fmt(check.utilization * 100, 1)}%`
      : "Util. -";
    status.innerHTML = `<strong>${check.inside ? "Inside curve" : "Outside curve"}</strong><span>${range}</span><span>${utilization}</span>`;
  });
}

function validate(sec, mat, point) {
  const messages = [];
  if (sec.layers.length === 0) {
    messages.push("Add at least one rebar layer.");
  }
  const minLayer = Math.min(...sec.positions);
  const maxLayer = Math.max(...sec.positions);
  if (minLayer < 0 || maxLayer >= sec.height) {
    messages.push("Rebar layers extend outside the column height. Keep each layer depth between 0 and h.");
  }
  if (mat.lambdaBlock <= 0 || mat.lambdaBlock > 1) {
    messages.push("Lambda should normally be between 0 and 1.");
  }
  if (numberValue("neutralAxis") <= 0) {
    messages.push("Neutral-axis depth must be greater than zero.");
  }
  if (point.mode === "pure compression" && Math.abs(point.m) > 0.05) {
    messages.push("Pure compression MRd is not zero because the rebar layer depths are not symmetric about h/2.");
  }
  return messages;
}

function updateModeVisibility() {
  const mode = document.querySelector("input[name='pointMode']:checked").value;
  $("neutralAxisGroup").hidden = mode !== "x";
  $("bottomStrainGroup").hidden = mode !== "strain";
}

function renderTable(point) {
  const rows = point.steelLayers.map((layer) => `
    <tr>
      <td>S${layer.layer}</td>
      <td>${fmt(layer.z, 1)}</td>
      <td>${layer.bars}</td>
      <td>${fmt(layer.area, 1)}</td>
      <td>${fmt(layer.strain, 3)}</td>
      <td>${fmt(layer.stress, 1)}</td>
      <td>${fmt(layer.force, 1)}</td>
      <td>${fmt(layer.lever, 3)}</td>
      <td>${fmt(layer.moment, 1)}</td>
    </tr>
  `).join("");

  $("steelBody").innerHTML = rows;
  const steelForce = point.steelLayers.reduce((sum, layer) => sum + layer.force, 0);
  const steelMoment = point.steelLayers.reduce((sum, layer) => sum + layer.moment, 0);
  $("concreteLine").textContent =
    `Cc = fcd * b * a = ${fmt(point.mat.fcd, 2)} * ${fmt(point.sec.width, 0)} * ${fmt(point.a, 1)} / 1000 = ${fmt(point.concreteForce, 1)} kN; ` +
    `sum Fs = ${fmt(steelForce, 1)} kN; ` +
    `NRd = ${fmt(point.concreteForce, 1)} + ${fmt(steelForce, 1)} = ${fmt(point.n, 1)} kN; ` +
    `sum Ms = ${fmt(steelMoment, 2)} kNm; MRd = ${fmt(point.m, 2)} kNm.`;
}

function renderSection(sec) {
  const svg = $("sectionSvg");
  const pad = 22;
  const w = 180;
  const h = 260;
  const scaleY = h / sec.height;
  const scaleX = w / sec.width;
  const sideInset = Math.min(50, sec.width * 0.22);
  const bars = sec.layers.flatMap((layer) => {
    const barXs = layer.bars === 1
      ? [sec.width / 2]
      : Array.from({ length: layer.bars }, (_, i) => sideInset + i * ((sec.width - 2 * sideInset) / Math.max(1, layer.bars - 1)));
    return barXs.map((x) => (
      `<circle cx="${pad + x * scaleX}" cy="${pad + layer.z * scaleY}" r="6" />`
    ));
  }).join("");
  svg.innerHTML = `
    <rect x="${pad}" y="${pad}" width="${w}" height="${h}" />
    ${bars}
    <line x1="${pad + w + 18}" y1="${pad}" x2="${pad + w + 18}" y2="${pad + h}" />
    <text x="${pad + w + 28}" y="${pad + 14}">top</text>
    <text x="${pad + w + 28}" y="${pad + h - 4}">bottom</text>
  `;
}

function renderLayersEditor() {
  $("layersList").innerHTML = rebarLayers.map((layer, index) => `
    <div class="layer-row" data-layer-index="${index}">
      <div class="layer-title">Layer ${index + 1}</div>
      <label>Depth z from top (mm)
        <input class="layer-depth" type="number" value="${layer.z}" min="0" step="1">
      </label>
      <label>Number of bars
        <input class="layer-bars" type="number" value="${layer.bars}" min="1" step="1">
      </label>
      <button class="remove-layer" type="button" ${rebarLayers.length === 1 ? "disabled" : ""}>Remove</button>
    </div>
  `).join("");
}

function renderDemandEditor() {
  $("demandList").innerHTML = demandRows.map((row, index) => `
    <div class="demand-row" data-demand-index="${index}">
      <div class="demand-title">Case ${index + 1}</div>
      <label>Axial force NEd (kN)
        <input class="demand-n" type="number" value="${row.n}" step="0.1">
      </label>
      <label>Moment MEd (kNm)
        <input class="demand-m" type="number" value="${row.m}" step="0.1">
      </label>
      <div class="demand-status demand-status--row" data-demand-status>-</div>
      <button class="remove-demand" type="button" ${demandRows.length === 1 ? "disabled" : ""}>Remove</button>
    </div>
  `).join("");
}

function renderChart(curve, point, demands, demandChecks) {
  const canvas = $("chart");
  const ctx = canvas.getContext("2d");
  const ratio = window.devicePixelRatio || 1;
  const cssWidth = canvas.clientWidth;
  const cssHeight = canvas.clientHeight;
  canvas.width = cssWidth * ratio;
  canvas.height = cssHeight * ratio;
  ctx.scale(ratio, ratio);
  ctx.clearRect(0, 0, cssWidth, cssHeight);

  const pad = { left: 68, right: 24, top: 28, bottom: 48 };
  const demandPoints = demands.map((demand) => ({ m: demand.absM, n: demand.n }));
  const all = [...curve, point, ...demandPoints];
  const maxMRaw = Math.max(...all.map((p) => Math.abs(p.m)), 1);
  const minNRaw = Math.min(...all.map((p) => p.n));
  const maxNRaw = Math.max(...all.map((p) => p.n));
  const maxM = niceCeil(maxMRaw * 1.08);
  const minN = niceFloor(minNRaw * 1.08);
  const maxN = niceCeil(maxNRaw * 1.08);
  const plotW = cssWidth - pad.left - pad.right;
  const plotH = cssHeight - pad.top - pad.bottom;
  const xMap = (m) => pad.left + (Math.abs(m) / maxM) * plotW;
  const yMap = (n) => pad.top + (maxN - n) / (maxN - minN) * plotH;

  ctx.font = "12px system-ui";
  ctx.textBaseline = "middle";
  ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth = 1;
  dynamicTicks(minN, maxN, 6).forEach((tick) => {
    const y = yMap(tick);
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(pad.left + plotW, y);
    ctx.stroke();
    ctx.fillStyle = "#64748b";
    ctx.textAlign = "right";
    ctx.fillText(fmt(tick, 0), pad.left - 10, y);
  });

  dynamicTicks(0, maxM, 6).forEach((tick) => {
    const x = xMap(tick);
    ctx.beginPath();
    ctx.moveTo(x, pad.top);
    ctx.lineTo(x, pad.top + plotH);
    ctx.stroke();
    ctx.fillStyle = "#64748b";
    ctx.textAlign = "center";
    ctx.fillText(fmt(tick, 0), x, pad.top + plotH + 20);
  });

  ctx.strokeStyle = "#94a3b8";
  ctx.beginPath();
  ctx.moveTo(pad.left, pad.top);
  ctx.lineTo(pad.left, pad.top + plotH);
  ctx.lineTo(pad.left + plotW, pad.top + plotH);
  ctx.stroke();

  ctx.fillStyle = "#475569";
  ctx.textAlign = "left";
  ctx.fillText("NRd kN", 10, pad.top + 12);
  ctx.textAlign = "right";
  ctx.fillText("MRd kNm", pad.left + plotW, cssHeight - 12);

  ctx.strokeStyle = "#246bfe";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  curve.forEach((p, i) => {
    const x = xMap(p.m);
    const y = yMap(p.n);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  drawLegend(ctx, pad.left + plotW - 158, pad.top + 8);

  ctx.fillStyle = "#e54747";
  const pointX = xMap(point.m);
  const pointY = yMap(point.n);
  ctx.beginPath();
  ctx.arc(pointX, pointY, 5, 0, Math.PI * 2);
  ctx.fill();

  const label = `N ${fmt(point.n, 0)} kN, M ${fmt(point.m, 0)} kNm`;
  ctx.font = "12px system-ui";
  const labelWidth = ctx.measureText(label).width + 16;
  const labelX = Math.min(Math.max(pointX + 10, pad.left), pad.left + plotW - labelWidth);
  const labelY = Math.max(pad.top + 14, pointY - 20);
  ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
  ctx.strokeStyle = "#fecaca";
  ctx.lineWidth = 1;
  roundRect(ctx, labelX, labelY - 13, labelWidth, 26, 6);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#991b1b";
  ctx.textAlign = "left";
  ctx.fillText(label, labelX + 8, labelY);

  demands.forEach((demand, index) => {
    const demandX = xMap(demand.absM);
    const demandY = yMap(demand.n);
    const check = demandChecks[index];
    const ok = check ? check.inside : false;
    ctx.strokeStyle = ok ? "#12805c" : "#b42318";
    ctx.fillStyle = "#ffffff";
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.rect(demandX - 6, demandY - 6, 12, 12);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = ok ? "#166534" : "#991b1b";
    ctx.font = "11px system-ui";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(index + 1), demandX, demandY);
  });
}

function drawLegend(ctx, x, y) {
  ctx.save();
  ctx.font = "12px system-ui";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
  ctx.strokeStyle = "#d8dee9";
  roundRect(ctx, x, y, 148, 56, 6);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = "#246bfe";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x + 12, y + 18);
  ctx.lineTo(x + 34, y + 18);
  ctx.stroke();
  ctx.fillStyle = "#475569";
  ctx.textAlign = "left";
  ctx.fillText("Interaction", x + 42, y + 18);
  ctx.strokeStyle = "#12805c";
  ctx.fillStyle = "#ffffff";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.rect(x + 18, y + 35, 10, 10);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#475569";
  ctx.fillText("Design actions", x + 42, y + 40);
  ctx.restore();
}

function niceCeil(value) {
  const step = niceStep(value / 5);
  return Math.ceil(value / step) * step;
}

function niceFloor(value) {
  const step = niceStep(Math.max(Math.abs(value), 1) / 5);
  return Math.floor(value / step) * step;
}

function niceStep(value) {
  const exponent = Math.floor(Math.log10(Math.max(value, 1e-9)));
  const fraction = value / 10 ** exponent;
  const niceFraction = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return niceFraction * 10 ** exponent;
}

function dynamicTicks(min, max, targetCount) {
  const span = Math.max(max - min, 1);
  const step = niceStep(span / Math.max(1, targetCount - 1));
  const start = Math.ceil(min / step) * step;
  const ticks = [];
  for (let value = start; value <= max + step * 0.5; value += step) {
    ticks.push(Math.abs(value) < step * 1e-8 ? 0 : value);
  }
  return ticks;
}

function roundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function renderCsv(curve) {
  const header = "mode,x_mm,a_mm,N_Rd_kN,M_Rd_kNm";
  const rows = curve.map((p) => [
    p.mode,
    p.x === null ? "" : fmt(p.x, 3),
    fmt(p.a, 3),
    fmt(p.n, 3),
    fmt(p.m, 3)
  ].join(","));
  $("csvOut").value = [header, ...rows].join("\n");
}

inputs.forEach((id) => $(id).addEventListener("input", update));
document.querySelectorAll("input[name='pointMode']").forEach((input) => input.addEventListener("change", update));
$("layersList").addEventListener("input", (event) => {
  const row = event.target.closest(".layer-row");
  if (!row) return;
  const index = Number(row.dataset.layerIndex);
  if (event.target.classList.contains("layer-depth")) {
    rebarLayers[index].z = Number(event.target.value);
  }
  if (event.target.classList.contains("layer-bars")) {
    rebarLayers[index].bars = Math.max(1, Math.round(Number(event.target.value)));
  }
  update();
});
$("layersList").addEventListener("click", (event) => {
  if (!event.target.classList.contains("remove-layer") || rebarLayers.length === 1) return;
  const row = event.target.closest(".layer-row");
  rebarLayers.splice(Number(row.dataset.layerIndex), 1);
  renderLayersEditor();
  update();
});
$("addLayerBtn").addEventListener("click", () => {
  const secHeight = numberValue("height");
  const lastDepth = rebarLayers.length ? Math.max(...rebarLayers.map((layer) => Number(layer.z))) : 50;
  const nextDepth = Math.min(secHeight - 50, lastDepth + 100);
  rebarLayers.push({ z: Math.max(0, nextDepth), bars: 2 });
  renderLayersEditor();
  update();
});
$("demandList").addEventListener("input", (event) => {
  const row = event.target.closest(".demand-row");
  if (!row) return;
  const index = Number(row.dataset.demandIndex);
  if (event.target.classList.contains("demand-n")) {
    demandRows[index].n = Number(event.target.value);
  }
  if (event.target.classList.contains("demand-m")) {
    demandRows[index].m = Number(event.target.value);
  }
  update();
});
$("demandList").addEventListener("click", (event) => {
  if (!event.target.classList.contains("remove-demand") || demandRows.length === 1) return;
  const row = event.target.closest(".demand-row");
  demandRows.splice(Number(row.dataset.demandIndex), 1);
  renderDemandEditor();
  update();
});
$("addDemandBtn").addEventListener("click", () => {
  demandRows.push({ n: 0, m: 0 });
  renderDemandEditor();
  update();
});
$("sampleBtn").addEventListener("click", () => {
  const mat = material();
  $("bottomStrain").value = mat.epsY.toFixed(3);
  document.querySelector("input[name='pointMode'][value='strain']").checked = true;
  update();
});
$("copyBtn").addEventListener("click", async () => {
  await navigator.clipboard.writeText($("csvOut").value);
  $("copyBtn").textContent = "Copied";
  setTimeout(() => $("copyBtn").textContent = "Copy CSV", 900);
});

renderLayersEditor();
renderDemandEditor();
update();
