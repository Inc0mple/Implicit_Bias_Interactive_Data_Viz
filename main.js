// --- Configuration ---
const SPLIT_DATA_DIR = 'data/split_by_model';
const MODELS_INDEX_PATH = `${SPLIT_DATA_DIR}/models.json`;
const plotlyDivId = 'plotly-heatmap';
const ITEMS_PER_LOAD = 100; // Examples per page in modal
const LUMINANCE_THRESHOLD = 0.35; // For choosing black/white text on heatmap cells
const DEFAULT_COSINE_MIN = 0.0; // Default heatmap range if calculation fails
const DEFAULT_COSINE_MAX = 0.5; // Adjusted default max based on typical ranges seen

// --- Selectors ---
const modelSelect = d3.select('#model-select');
const metricSelect = d3.select('#metric-select');
const powerSelect = d3.select('#power-select');
const globalControlsDiv = document.getElementById('global-controls');
const preambleDiv = document.getElementById('preamble');
const overallFindingsDiv = document.getElementById('overall-findings');
const scenariosContainer = document.getElementById('scenarios-list-container');
const scenariosListDiv = document.getElementById('scenarios-list');
const scenarioCountSpan = document.getElementById('scenario-count');
const scenarioFilterInput = document.getElementById('scenario-filter');
const demographicsContainer = document.getElementById('demographics-list-container');
const demographicsListDiv = document.getElementById('demographics-list');
const interpretationsContainer = document.getElementById('heatmap-interpretations'); // The collapsible section
const interpretationsTitle = document.getElementById('interpretations-title');
const interpretationsContent = document.getElementById('interpretations-content'); // Where the table goes
const modalOverlay = document.getElementById('modal-overlay');
const modalContent = document.getElementById('modal-content');
const modalTitle = document.getElementById('modal-title');
const modalBody = document.getElementById('modal-body');
const modalCloseBtn = document.getElementById('modal-close'); // The fixed 'X' button
const modalLoadMoreBtn = document.getElementById('modal-load-more');
const plotlyDiv = document.getElementById(plotlyDivId);
const avgMetricNoPdSpan = document.getElementById('avg-metric-no-pd');
const avgMetricPdSpan = document.getElementById('avg-metric-pd');
const overallMeanSpan = document.getElementById('overall-mean');
const overallStdevSpan = document.getElementById('overall-stdev');


// --- Global Variables ---
let rawData = []; // Combined data from all loaded CSVs
let aggregatedData = {}; // Pre-calculated averages for heatmap
let uniqueModels = []; // Populated from models.json
let currentMetricInfo = {}; // Info about the currently selected metric
let uniqueScenarios = []; // Stores { id, text, context, power }
let demographicsStructure = {}; // Stores { Axis: [Identities...] }
let modalCurrentData = []; // Data for the currently displayed modal
let modalItemsShown = 0; // Number of items currently shown in the modal
let modelFilenameStems = {}; // Mapping from model name to filename stem
let scenarioTextMap = new Map(); // Map scenario ID to text for quick lookup in modal

// --- Plotly Color Scales ---
const cosineColorScale = 'Viridis'; // Plotly named scale
const winRateColorScale = [
    [0,    'rgb(255, 0, 0)'],  // Crimson
    // [0.3, 'rgb(215, 55, 90)'],  // Stay Crimson just before mid
    [0.5,  'rgb(128, 128, 128)'],// Grey at mid
    // [0.7, 'rgb(53, 214, 53)'],  // Switch to LimeGreen just after mid (less harsh than pure lime)
    [1,    'rgb(0, 255, 0)']   // LimeGreen
];
// --- Helper Functions ---

/**
 * Parses a row from the CSV, converting types as needed.
 * @param {object} d - Row object from d3.csv
 * @returns {object} Parsed row object
 */
function parseRow(d) {
    return {
        scenario_id: +d.scenario_id,
        contextual_dim: d.contextual_dim,
        demographic_dim: d.demographic_dim,
        power_differential: +d.power_differential,
        sub_persona_context: d.sub_persona_context,
        sub_persona_demog: d.sub_persona_demog,
        sub_persona_final: d.sub_persona_final,
        res_persona_context: d.res_persona_context,
        res_persona_demog: d.res_persona_demog,
        res_persona_final: d.res_persona_final,
        scenario: d.scenario,
        instruction: d.instruction,
        prompt: d.prompt,
        response: d.response,
        final_scenario_id: +d.final_scenario_id, // Use nullish coalescing later if needed
        cosine_dist_from_no_demog: +d.cosine_dist_from_no_demog,
        model_abbrv: d.model_abbrv,
        response_non_demog: d.response_non_demog,
        score: +d.score
    };
}

/**
 * Gets unique sorted labels for heatmap axes based on demographic dimension.
 * @param {Array} dataForSorting - Subset of raw data relevant to current view
 * @param {string} personaType - 'sub_persona_demog' or 'res_persona_demog'
 * @param {object} demographicDimMap - Mapping from persona identity to demographic axis
 * @returns {Array} Sorted array of unique labels
 */
function getSortedLabels(dataForSorting, personaType, demographicDimMap) {
    const labels = [...new Set(dataForSorting.map(d => d[personaType]).filter(Boolean))];
    labels.sort((a, b) => {
        const dimA = demographicDimMap[a] || 'zzzz'; // Sort unknown last
        const dimB = demographicDimMap[b] || 'zzzz';
        if (dimA < dimB) return -1;
        if (dimA > dimB) return 1;
        if (a < b) return -1; // Secondary sort alphabetically
        if (a > b) return 1;
        return 0;
    });
    return labels;
}

/**
 * Pre-aggregates raw data into averages for faster heatmap generation.
 * @param {Array} data - The combined raw dataset
 * @returns {object} Aggregated data object structured by model and power filter
 */
function preAggregateData(data) {
    console.log("Pre-aggregating data...");
    const aggregation = {};
    // uniqueModels should already be populated
    uniqueModels.forEach(model => {
        aggregation[model] = { 'all': {}, '0': {}, '1': {} }; // Initialize power filters
        const modelData = data.filter(d => d.model_abbrv === model);
        modelData.forEach(row => {
            const sub = row.sub_persona_demog;
            const res = row.res_persona_demog;
            if (!sub || !res) return; // Skip rows missing persona demographics

            const power = String(row.power_differential);
            const key = `${sub}||${res}`; // Unique key for sub/res pair

            // Initialize accumulators if key doesn't exist
            for (const filter of ['all', power]) {
                 if (!aggregation[model][filter][key]) {
                     aggregation[model][filter][key] = { cosSum: 0, cosCount: 0, scoreSum: 0, scoreCount: 0 };
                 }
                 // Accumulate sums and counts
                 if (!isNaN(row.cosine_dist_from_no_demog)) {
                     aggregation[model][filter][key].cosSum += row.cosine_dist_from_no_demog;
                     aggregation[model][filter][key].cosCount++;
                 }
                 if (!isNaN(row.score)) {
                     aggregation[model][filter][key].scoreSum += row.score;
                     aggregation[model][filter][key].scoreCount++;
                 }
            }
        });

        // Calculate averages for each power filter
        ['all', '0', '1'].forEach(powerFilter => {
            for (const key in aggregation[model][powerFilter]) {
                const agg = aggregation[model][powerFilter][key];
                const avgCos = agg.cosCount > 0 ? agg.cosSum / agg.cosCount : NaN;
                const avgScore = agg.scoreCount > 0 ? agg.scoreSum / agg.scoreCount : NaN;
                // Store averages and the representative count
                aggregation[model][powerFilter][key] = {
                    avgCos: avgCos,
                    avgScore: avgScore,
                    count: Math.max(agg.cosCount, agg.scoreCount)
                };
            }
        });
    });
    console.log("Aggregation complete.");
    return aggregation;
}

/**
 * Converts various CSS color formats to an {r, g, b} object.
 * @param {string} colorStr - Color string (e.g., '#rgb', '#rrggbb', 'rgb(r,g,b)')
 * @returns {object} Object with r, g, b properties (0-255)
 */
function parseColor(colorStr) {
    if (!colorStr) return { r: 128, g: 128, b: 128 }; // Default grey
    let r = 0, g = 0, b = 0;
    if (colorStr.startsWith('#')) {
        if (colorStr.length === 4) { r = parseInt(colorStr[1] + colorStr[1], 16); g = parseInt(colorStr[2] + colorStr[2], 16); b = parseInt(colorStr[3] + colorStr[3], 16); }
        else if (colorStr.length === 7) { const bigint = parseInt(colorStr.slice(1), 16); r = (bigint >> 16) & 255; g = (bigint >> 8) & 255; b = bigint & 255; }
    } else if (colorStr.startsWith('rgb')) {
        const match = colorStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (match) { r = parseInt(match[1], 10); g = parseInt(match[2], 10); b = parseInt(match[3], 10); }
    }
    return { r, g, b };
}

/**
 * Calculates perceived luminance (Y) from an RGB color object.
 * @param {object} rgb - Object with r, g, b properties (0-255)
 * @returns {number} Luminance value between 0 (black) and 1 (white)
 */
function getLuminance(rgb) {
    const RsRGB = rgb.r / 255; const GsRGB = rgb.g / 255; const BsRGB = rgb.b / 255;
    const R = (RsRGB <= 0.03928) ? RsRGB / 12.92 : Math.pow(((RsRGB + 0.055) / 1.055), 2.4);
    const G = (GsRGB <= 0.03928) ? GsRGB / 12.92 : Math.pow(((GsRGB + 0.055) / 1.055), 2.4);
    const B = (BsRGB <= 0.03928) ? BsRGB / 12.92 : Math.pow(((BsRGB + 0.055) / 1.055), 2.4);
    return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

/**
 * Interpolates a color from a Plotly colorscale for a given value.
 * @param {number} value - The value to get the color for.
 * @param {number} zmin - The minimum value of the scale.
 * @param {number} zmax - The maximum value of the scale.
 * @param {string|Array} colorscale - Plotly colorscale (named string or array format)
 * @returns {string|null} RGB color string 'rgb(r,g,b)' or null for invalid input.
 */
function getColorForValue(value, zmin, zmax, colorscale) {
    if (isNaN(value) || value === null) return null;
    const range = zmax - zmin;
    if (range <= 0) return typeof colorscale === 'string' ? '#808080' : (colorscale[0]?.[1] || '#808080'); // Handle invalid range/scale

    const normalizedValue = Math.max(0, Math.min(1, (value - zmin) / range));
    let scaleToUse;
    if (typeof colorscale === 'string') { // Handle named scales (approximations needed)
        if (colorscale.toLowerCase() === 'viridis') { scaleToUse = [[0, 'rgb(68,1,84)'], [0.25, 'rgb(59,82,139)'], [0.5, 'rgb(33,145,140)'], [0.75, 'rgb(94,201,98)'], [1, 'rgb(253,231,37)']]; }
        else { scaleToUse = [[0, 'rgb(0,0,255)'], [1, 'rgb(255,0,0)']]; } // Default simple scale
    } else { scaleToUse = colorscale; } // Use provided array scale

    let lowerBound = scaleToUse[0]; let upperBound = scaleToUse[scaleToUse.length - 1];
    for (let i = 0; i < scaleToUse.length - 1; i++) { if (normalizedValue >= scaleToUse[i][0] && normalizedValue <= scaleToUse[i + 1][0]) { lowerBound = scaleToUse[i]; upperBound = scaleToUse[i + 1]; break; } }
    const scaleRange = upperBound[0] - lowerBound[0]; const scaleFraction = scaleRange === 0 ? 0 : (normalizedValue - lowerBound[0]) / scaleRange;
    const lowerColor = parseColor(lowerBound[1]); const upperColor = parseColor(upperBound[1]);
    const r = Math.round(lowerColor.r + (upperColor.r - lowerColor.r) * scaleFraction);
    const g = Math.round(lowerColor.g + (upperColor.g - lowerColor.g) * scaleFraction);
    const b = Math.round(lowerColor.b + (upperColor.b - lowerColor.b) * scaleFraction);
    return `rgb(${r},${g},${b})`;
}


// --- UI Population Functions ---

/** Populates the scenario list in the HTML */
function populateScenarioList() {
    const groupedScenarios = d3.group(uniqueScenarios, d => d.context);
    let html = '';
    const sortedContexts = Array.from(groupedScenarios.keys()).sort();
    for (const context of sortedContexts) {
        const scenariosInGroup = groupedScenarios.get(context).sort((a, b) => a.id - b.id);
        html += `<div class="scenario-group" data-context="${context}">`;
        html += `<h3>${context}</h3>`;
        scenariosInGroup.forEach(s => {
            html += `<div class="scenario-item" id="scenario-${s.id}" data-scenario-id="${s.id}" data-scenario-text="${s.text.toLowerCase()}">`;
            html += `<strong>ID ${s.id}:</strong> ${s.text}`;
            if (s.power === 1) { html += `<span class="pd-tag">(Power Disparity)</span>`; }
            html += `</div>`;
        });
        html += `</div>`;
    }
    scenariosListDiv.innerHTML = html;
    scenarioCountSpan.textContent = uniqueScenarios.length;
}

/** Populates the demographics list in the HTML */
function populateDemographicsList() {
    let html = '';
    const sortedAxes = Object.keys(demographicsStructure).sort();

    for (const axis of sortedAxes) {
        const axisId = axis.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-]/g, ''); // Create safe ID
        const identities = demographicsStructure[axis].sort(); // Get sorted identities
        const identitiesString = identities.join(', '); // Join identities with a comma and space

        // Use a single div per axis, place title and identities inside
        html += `<div class="demographic-axis compact" id="demographic-${axisId}">`; // Added 'compact' class
        // Use <strong> for the title and put identities directly after
        html += `<strong>${axis}:</strong> `;
        html += `<span class="identity-list">${identitiesString}</span>`; // Wrap identities in a span
        html += `</div>`;
    }
    demographicsListDiv.innerHTML = html;
}

/** Filters the scenario list based on text input */
function filterScenarios() {
    const filterText = scenarioFilterInput.value.toLowerCase().trim();
    const items = scenariosListDiv.querySelectorAll('.scenario-item');
    const isFilteringById = /^\d+$/.test(filterText); // Check if input is just digits
    items.forEach(item => {
        const scenarioText = item.dataset.scenarioText || '';
        const scenarioId = item.dataset.scenarioId || '';
        const context = item.closest('.scenario-group')?.dataset?.context?.toLowerCase() || '';
        let isVisible = false;
        if (filterText === '') { isVisible = true; }
        else if (isFilteringById && scenarioId === filterText) { isVisible = true; } // ID match
        else if (!isFilteringById && (scenarioText.includes(filterText) || context.includes(filterText))) { isVisible = true; } // Text match
        item.style.display = isVisible ? '' : 'none';
        item.classList.toggle('highlight', isVisible && filterText !== '');
    });
}


// --- Heatmap Interpretation Function ---
/**
 * Analyzes heatmap data and generates a concise summary table.
 * @param {object} currentAggData - Aggregated data for the selected view.
 * @param {object} currentDemogMap - Identity-to-axis map for the view.
 * @param {string} metricLabel - Display label for the metric.
 * @param {string} metricKey - Data key for the metric ('avgCos' or 'avgScore').
 */
function generateAndDisplayInterpretations(currentAggData, currentDemogMap, metricLabel, metricKey, selectedModel) {
    if (!currentAggData || Object.keys(currentAggData).length === 0) {
        interpretationsContent.innerHTML = "<p>No data available for interpretation.</p>";
        return;
    }

    const interpretationsByAxis = {}; // { Axis: { minVal, maxVal, minPair, maxPair, count } }

    // Aggregate min/max within each axis
    for (const key in currentAggData) {
        const [sub, res] = key.split('||');
        const dataPoint = currentAggData[key];
        const value = dataPoint[metricKey];
        if (value === null || isNaN(value)) continue;
        const axis = currentDemogMap[sub] || currentDemogMap[res];
        if (!axis) continue;
        if (!interpretationsByAxis[axis]) { interpretationsByAxis[axis] = { minVal: Infinity, maxVal: -Infinity, minPair: '', maxPair: '', count: 0 }; }
        const pairStr = `${res} (RES) → ${sub} (SUB)`;
        interpretationsByAxis[axis].count++;
        if (value < interpretationsByAxis[axis].minVal) { interpretationsByAxis[axis].minVal = value; interpretationsByAxis[axis].minPair = pairStr; }
        if (value > interpretationsByAxis[axis].maxVal) { interpretationsByAxis[axis].maxVal = value; interpretationsByAxis[axis].maxPair = pairStr; }
    }

    // --- Generate Preamble & Table HTML ---
    let html = '';
    const metricTypeShort = metricKey === 'avgCos' ? 'Cosine Distance from the Non-Demog Response' : 'Win Rate (Quality)';

    // ** NEW: Add Preamble Text **
    html += `<p class="interpretation-preamble">
                The table below summarises the <strong>demographic pairs</strong> with the highest and lowest average <strong>${metricTypeShort}</strong>
                within each demographic axis for the <strong>${selectedModel}</strong> model,
                based on the current filter settings. It shows which specific <strong>Responder → Subject</strong>
                persona pairings led to the most extreme results.
            </p>`;

    // Start Table
    html += '<table>';
    // Table Header
    html += `<thead><tr>
               <th>Demographic Axis</th>
               <th>Highest ${metricTypeShort} Pair (RES → SUB)</th>
               <th>Max Value</th>
               <th>Lowest ${metricTypeShort} Pair (RES → SUB)</th>
               <th>Min Value</th>
             </tr></thead>`;

    // Table Body
    html += '<tbody>';
    const sortedAxes = Object.keys(interpretationsByAxis).sort();
    if (sortedAxes.length === 0) {
        html += '<tr><td colspan="5" class="na-cell">No specific demographic interactions found.</td></tr>';
    } else {
        sortedAxes.forEach(axis => {
            const data = interpretationsByAxis[axis];
            const axisId = axis.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-]/g, '');
            html += '<tr>';
            html += `<td><span class="info-link" data-target-id="demographic-${axisId}" data-highlight-type="section">${axis}</span></td>`; // Axis Name
            if (data.count === 0 || data.minVal === Infinity) {
                html += `<td colspan="4" class="na-cell">N/A</td>`;
            } else {
                html += `<td class="pair-cell">${data.maxPair}</td>`; // Highest Pair
                html += `<td class="value-cell highest-value">${data.maxVal.toFixed(3)}</td>`; // Max Value
                html += `<td class="pair-cell">${data.minPair}</td>`; // Lowest Pair
                html += `<td class="value-cell lowest-value">${data.minVal.toFixed(3)}</td>`; // Min Value
            }
            html += '</tr>';
        });
    }
    html += '</tbody></table>';
    interpretationsContent.innerHTML = html;
}

// --- Plotting Function ---
/** Updates the Plotly heatmap visualization and interpretations */
function updateVisualization() {
    // ... (Setup: selectedModel, selectedMetricKey, selectedPowerFilter - unchanged) ...
    const selectedModel = modelSelect.node().value;
    const selectedMetricKey = metricSelect.node().value;
    const selectedPowerFilter = powerSelect.node().value;

    // ... (Get aggregated data: modelPowerAggData - unchanged) ...
    const modelPowerAggData = aggregatedData[selectedModel]?.[selectedPowerFilter];
    if (!modelPowerAggData || Object.keys(modelPowerAggData).length === 0) { Plotly.purge(plotlyDivId); plotlyDiv.innerHTML = "<p>No data available.</p>"; interpretationsContent.innerHTML = "<p>No data available for interpretation.</p>"; overallMeanSpan.textContent = 'N/A'; overallStdevSpan.textContent = 'N/A'; closeModal(); return; }

    // ... (Calculate Dynamic Range - unchanged) ...
    let dynamicZmin = DEFAULT_COSINE_MIN; let dynamicZmax = DEFAULT_COSINE_MAX; if (selectedMetricKey === 'cosine_dist_from_no_demog') { let minCos = Infinity, maxCos = -Infinity, found = false; Object.values(modelPowerAggData).forEach(e => { if (e.avgCos !== null && !isNaN(e.avgCos)) { minCos = Math.min(minCos, e.avgCos); maxCos = Math.max(maxCos, e.avgCos); found = true; } }); if (found) { dynamicZmin = Math.max(0, Math.floor(minCos / 0.05) * 0.05); dynamicZmax = Math.ceil(maxCos / 0.05) * 0.05; if (dynamicZmax <= dynamicZmin) dynamicZmax = dynamicZmin + 0.05; } }

    // ... (Determine metric info - unchanged) ...
    if (selectedMetricKey === 'cosine_dist_from_no_demog') { currentMetricInfo = { key: 'avgCos', label: 'Avg Cosine Distance', colorscale: cosineColorScale, zmin: dynamicZmin, zmax: dynamicZmax }; } else { currentMetricInfo = { key: 'avgScore', label: 'Avg Win Rate', colorscale: winRateColorScale, zmin: 0, zmax: 1 }; }

    // ... (Prepare Data & Get Demog Map - unchanged) ...
    const currentKeys = Object.keys(modelPowerAggData); const currentSubLabelsSet = new Set(currentKeys.map(k => k.split('||')[0])); const currentResLabelsSet = new Set(currentKeys.map(k => k.split('||')[1])); const relevantRawDataForView = rawData.filter(d => d.model_abbrv === selectedModel && (selectedPowerFilter === 'all' || String(d.power_differential) === selectedPowerFilter) && currentSubLabelsSet.has(d.sub_persona_demog) && currentResLabelsSet.has(d.res_persona_demog)); const currentDemogMap = {}; relevantRawDataForView.forEach(d => { if (d.sub_persona_demog && d.demographic_dim) currentDemogMap[d.sub_persona_demog] = d.demographic_dim; if (d.res_persona_demog && d.demographic_dim) currentDemogMap[d.res_persona_demog] = d.demographic_dim; });
    const sortedSubLabels = getSortedLabels(relevantRawDataForView, 'sub_persona_demog', currentDemogMap); const sortedResLabels = getSortedLabels(relevantRawDataForView, 'res_persona_demog', currentDemogMap); const subMeanLabel = 'RES Mean across all SUB'; const resMeanLabel = 'SUB Mean across all RES'; const yLabelsOriginalOrder = [...sortedSubLabels, subMeanLabel]; const xLabels = [...sortedResLabels, resMeanLabel]; const zValuesOriginalOrder = Array(yLabelsOriginalOrder.length).fill(null).map(() => Array(xLabels.length).fill(NaN)); const hoverTextOriginalOrder = Array(yLabelsOriginalOrder.length).fill(null).map(() => Array(xLabels.length).fill('')); const customDataOriginalOrder = Array(yLabelsOriginalOrder.length).fill(null).map(() => Array(xLabels.length).fill(null)); const yIndexMap = new Map(yLabelsOriginalOrder.map((lbl, i) => [lbl, i])); const xIndexMap = new Map(xLabels.map((lbl, i) => [lbl, i]));
    for (const key in modelPowerAggData) { const [sub, res] = key.split('||'); const dataPoint = modelPowerAggData[key]; const metricValue = dataPoint[currentMetricInfo.key]; const count = dataPoint.count; const rowIndex = yIndexMap.get(sub); const colIndex = xIndexMap.get(res); if (rowIndex !== undefined && colIndex !== undefined) { const displayValue = isNaN(metricValue) ? null : metricValue; zValuesOriginalOrder[rowIndex][colIndex] = displayValue; hoverTextOriginalOrder[rowIndex][colIndex] = `<b>SUB:</b> ${sub}<br><b>RES:</b> ${res}<br><b>${currentMetricInfo.label}:</b> ${displayValue === null ? 'N/A' : displayValue.toFixed(3)}<br><b>Count:</b> ${count}`; customDataOriginalOrder[rowIndex][colIndex] = { sub: sub, res: res, value: metricValue, count: count, isMean: false }; } } const rowMeanIndex = yIndexMap.get(subMeanLabel); const colMeanIndex = xIndexMap.get(resMeanLabel); for (let i = 0; i < sortedSubLabels.length; i++) { const sub = sortedSubLabels[i]; let sum = 0, totalCount = 0; for (let j = 0; j < sortedResLabels.length; j++) { const res = sortedResLabels[j]; const key = `${sub}||${res}`; if (modelPowerAggData[key]) { const val = modelPowerAggData[key][currentMetricInfo.key]; const cnt = modelPowerAggData[key].count; if (!isNaN(val) && cnt > 0) { sum += val * cnt; totalCount += cnt; } } } const mean = totalCount > 0 ? sum / totalCount : NaN; const displayMean = isNaN(mean) ? null : mean; zValuesOriginalOrder[i][colMeanIndex] = displayMean; hoverTextOriginalOrder[i][colMeanIndex] = `<b>SUB:</b> ${sub}<br><b>RES:</b> Mean<br><b>${currentMetricInfo.label}:</b> ${displayMean === null ? 'N/A' : displayMean.toFixed(3)}<br><b>Total Count:</b> ${totalCount}`; customDataOriginalOrder[i][colMeanIndex] = { sub: sub, res: resMeanLabel, value: mean, count: totalCount, isMean: true, meanType: 'row' }; } for (let j = 0; j < sortedResLabels.length; j++) { const res = sortedResLabels[j]; let sum = 0, totalCount = 0; for (let i = 0; i < sortedSubLabels.length; i++) { const sub = sortedSubLabels[i]; const key = `${sub}||${res}`; if (modelPowerAggData[key]) { const val = modelPowerAggData[key][currentMetricInfo.key]; const cnt = modelPowerAggData[key].count; if (!isNaN(val) && cnt > 0) { sum += val * cnt; totalCount += cnt; } } } const mean = totalCount > 0 ? sum / totalCount : NaN; const displayMean = isNaN(mean) ? null : mean; zValuesOriginalOrder[rowMeanIndex][j] = displayMean; hoverTextOriginalOrder[rowMeanIndex][j] = `<b>SUB:</b> Mean<br><b>RES:</b> ${res}<br><b>${currentMetricInfo.label}:</b> ${displayMean === null ? 'N/A' : displayMean.toFixed(3)}<br><b>Total Count:</b> ${totalCount}`; customDataOriginalOrder[rowMeanIndex][j] = { sub: subMeanLabel, res: res, value: mean, count: totalCount, isMean: true, meanType: 'column' }; } let grandSum = 0, grandCount = 0; for(const key in modelPowerAggData){ const val = modelPowerAggData[key][currentMetricInfo.key]; const cnt = modelPowerAggData[key].count; if (!isNaN(val) && cnt > 0) { grandSum += val * cnt; grandCount += cnt; } } const grandMean = grandCount > 0 ? grandSum / grandCount : NaN; const displayGrandMean = isNaN(grandMean) ? null : grandMean; zValuesOriginalOrder[rowMeanIndex][colMeanIndex] = displayGrandMean; hoverTextOriginalOrder[rowMeanIndex][colMeanIndex] = `<b>SUB:</b> Mean<br><b>RES:</b> Mean<br><b>${currentMetricInfo.label}:</b> ${displayGrandMean === null ? 'N/A' : displayGrandMean.toFixed(3)}<br><b>Total Count:</b> ${grandCount}`; customDataOriginalOrder[rowMeanIndex][colMeanIndex] = { sub: subMeanLabel, res: resMeanLabel, value: grandMean, count: grandCount, isMean: true, meanType: 'grand' };
    const yLabels = [...yLabelsOriginalOrder].reverse(); const zValues = [...zValuesOriginalOrder].reverse(); const hoverText = [...hoverTextOriginalOrder].reverse(); const customData = [...customDataOriginalOrder].reverse();

    // Define Plotly Trace
    const trace = { z: zValues, x: xLabels, y: yLabels, type: 'heatmap', colorscale: currentMetricInfo.colorscale, zmin: currentMetricInfo.zmin, zmax: currentMetricInfo.zmax, hoverongaps: false, text: hoverText, hoverinfo: 'text', customdata: customData, showscale: true, colorbar: { title: { text: currentMetricInfo.label, side: 'right' } } };

    // Calculate Annotations
    const annotations = []; for (let i = 0; i < yLabels.length; i++) { for (let j = 0; j < xLabels.length; j++) { const value = zValues[i][j]; if (value !== null && !isNaN(value)) { const bgColor = getColorForValue(value, currentMetricInfo.zmin, currentMetricInfo.zmax, currentMetricInfo.colorscale); const luminance = getLuminance(parseColor(bgColor)); const textColor = luminance > LUMINANCE_THRESHOLD ? 'black' : 'white'; annotations.push({ x: xLabels[j], y: yLabels[i], text: value.toFixed(2), showarrow: false, font: { family: 'Arial', size: 15, color: textColor, weight: 'bold' } }); } } }

    // Define Plotly Layout
    const layout = { title: {text: `<b>Heatmap of ${currentMetricInfo.label} Across various Subject and Responder demography for Model: ${selectedModel}<br>(Power Disparity: ${selectedPowerFilter === 'all' ? 'All' : (selectedPowerFilter === '1' ? 'Present' : 'Absent')})</b>`}, xaxis: { title: { text: '<b>Responder Persona Demographic (RES)</b>', font: { size: 14 } }, tickangle: -45, automargin: true, tickvals: xLabels, ticktext: xLabels.map(lbl => lbl.includes('Mean') ? `<i><b>${lbl}</b></i>` : lbl), fixedrange: true }, yaxis: { title: { text: '<b>Subject Persona Demographic (SUB)</b>', font: { size: 14 } }, automargin: true, tickvals: yLabels, ticktext: yLabels.map(lbl => lbl.includes('Mean') ? `<i><b>${lbl}</b></i>` : lbl), fixedrange: true }, margin: { l: 200, r: 50, b: 150, t: 100, pad: 4 }, autosize: true, annotations: annotations };
    const config = { responsive: true, displaylogo: false, modeBarButtonsToRemove: ['select2d', 'lasso2d', 'zoomIn2d', 'zoomOut2d', 'autoScale2d', 'resetScale2d'] };

    // Create/Update Plot
    Plotly.newPlot(plotlyDivId, [trace], layout, config);

    // Calculate and Display Overall Mean/Std Dev
    const currentValues = Object.values(modelPowerAggData).map(entry => entry[currentMetricInfo.key]).filter(val => val !== null && !isNaN(val));
    let overallMean = NaN; let overallStdev = NaN;
    if (currentValues.length > 0) { overallMean = currentValues.reduce((sum, val) => sum + val, 0) / currentValues.length; if (currentValues.length > 1) { const variance = currentValues.reduce((sumSqDiff, val) => sumSqDiff + Math.pow(val - overallMean, 2), 0) / currentValues.length; overallStdev = Math.sqrt(variance); } else { overallStdev = 0; } }
    overallMeanSpan.textContent = isNaN(overallMean) ? 'N/A' : overallMean.toFixed(3); overallStdevSpan.textContent = isNaN(overallStdev) ? 'N/A' : overallStdev.toFixed(3);

    // Generate and Display Interpretations
    interpretationsTitle.textContent = `Interpretations for ${selectedModel} (${selectedPowerFilter === 'all' ? 'All Scenarios' : (selectedPowerFilter === '1' ? 'Power Disparity' : 'No Power Disparity')})`;
    generateAndDisplayInterpretations(modelPowerAggData, currentDemogMap, currentMetricInfo.label, currentMetricInfo.key, selectedModel);

    // --- ** MODIFIED ** Attach Click Handler for Modal ---
    plotlyDiv.removeAllListeners('plotly_click');
    plotlyDiv.on('plotly_click', (data) => {
        if (data.points.length > 0) {
            const pointData = data.points[0];
            const clickedCustomData = pointData.customdata; // Get the data we stored

            // Check if customData exists before trying to access properties
            if (clickedCustomData) {
                // Call openModal regardless of whether it's a mean or not,
                // pass the clickedCustomData so openModal can decide how to filter
                openModal(selectedModel, clickedCustomData, selectedPowerFilter);
            } else {
                console.warn("Click detected, but no custom data found on the point.");
            }
        }
    });
}


// --- ** MODIFIED ** Modal Functions ---

// generateDetailsHtml remains the same as the previous version
function generateDetailsHtml(dataToShow, startIndex = 0) { /* ... (unchanged - includes scenario text, 2-col layout, correct index) ... */ let detailsHtml = ''; dataToShow.forEach((row, i) => { const displayIndex = startIndex + i + 1; const scenarioKey = row.final_scenario_id ?? row.scenario_id; const scenarioInfo = scenarioTextMap.get(scenarioKey); const scenarioText = scenarioInfo ? scenarioInfo.text : 'Scenario text not found.'; const scenarioLink = `<span class="info-link" data-target-id="scenarios-list-container" data-highlight-scenario="${scenarioKey}">${scenarioKey}</span>`; const subDemogLink = `<span class="info-link" data-target-id="demographic-${row.demographic_dim?.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-]/g, '')}" data-highlight-identity="${row.sub_persona_demog}">${row.sub_persona_demog}</span>`; const resDemogLink = `<span class="info-link" data-target-id="demographic-${row.demographic_dim?.replace(/\s+/g, '-')?.replace(/[^a-zA-Z0-9-]/g, '')}" data-highlight-identity="${row.res_persona_demog}">${row.res_persona_demog}</span>`; const winRate = row.score; let winRateCategory = 'na'; if (winRate !== null && !isNaN(winRate)) { if (winRate === 0) winRateCategory = '0'; else if (winRate === 0.25) winRateCategory = '025'; else if (winRate === 0.5) winRateCategory = '05'; else if (winRate === 0.75) winRateCategory = '075'; else if (winRate === 1) winRateCategory = '1'; } detailsHtml += ` <div class="modal-example-item"> <p class="item-title"><strong>Sample ${displayIndex} of ${modalCurrentData.length}</strong></p> <div class="details-columns"> <div class="details-column"> <p><strong>Scenario ID:</strong> ${scenarioLink}</p> <p><strong>Power Diff:</strong> ${row.power_differential === 1 ? 'Present (1)' : 'Absent (0)'}</p> </div> <div class="details-column"> <p><strong>SUB (Alex) Persona:</strong> ${subDemogLink}</p> <p><strong>RES (Blake) Persona:</strong> ${resDemogLink}</p> </div> </div> <div class="scenario-text-container"> <p><strong>Scenario Text:</strong></p> <p class="scenario-text-content">${scenarioText}</p> </div> <div class="response-container"> <p> <strong>Demog Response (By Blake):</strong> <span class="metric-inline"> (Cos Dist: <span class="metric-value cosine-value">${row.cosine_dist_from_no_demog?.toFixed(4) ?? 'N/A'}</span> | Win Rate: <span class="metric-value winrate-value" data-winrate-value="${winRateCategory}">${winRate?.toFixed(2) ?? 'N/A'}</span>) </span> <span class="modal-response demog-resp">${row.response?.trim() || '(No Response)'}</span> </p> <p> <strong>Non-Demog Resp (By Blake):</strong> <span class="modal-response baseline-resp">${row.response_non_demog?.trim() || '(No Response)'}</span> </p> </div> </div>`; }); return detailsHtml; }

// **MODIFIED** openModal to handle mean cell clicks
/**
 * Opens the modal and populates it with details. Handles both regular and mean cell clicks.
 * @param {string} model - Selected model name.
 * @param {object} clickData - The customdata object from the clicked heatmap cell.
 * @param {string} powerFilter - Current power disparity filter ('all', '0', '1').
 */
function openModal(model, clickData, powerFilter) {
    let title = '';
    let filterConditions = (row) => row.model_abbrv === model && (powerFilter === 'all' || String(row.power_differential) === powerFilter);

    if (clickData.isMean) {
        // --- Handle Mean Cell Clicks ---
        if (clickData.meanType === 'row') {
            // Filter by specific SUB, any RES
            title = `Examples for Mean: ${clickData.sub} (SUB) across all RES`;
            filterConditions = (row) => row.model_abbrv === model &&
                                       row.sub_persona_demog === clickData.sub &&
                                       (powerFilter === 'all' || String(row.power_differential) === powerFilter);
        } else if (clickData.meanType === 'column') {
            // Filter by specific RES, any SUB
            title = `Examples for Mean: ${clickData.res} (RES) across all SUB`;
            filterConditions = (row) => row.model_abbrv === model &&
                                       row.res_persona_demog === clickData.res &&
                                       (powerFilter === 'all' || String(row.power_differential) === powerFilter);
        } else if (clickData.meanType === 'grand') {
            // Filter only by model and power
            title = `Examples for Overall Mean`;
            filterConditions = (row) => row.model_abbrv === model &&
                                       (powerFilter === 'all' || String(row.power_differential) === powerFilter);
        } else {
            console.error("Unknown mean type clicked:", clickData.meanType);
            return; // Don't open modal for unknown mean type
        }
        // Ensure we don't include rows where sub/res personas might be null/undefined if filtering was too broad
         modalCurrentData = rawData.filter(row => filterConditions(row) && row.sub_persona_demog && row.res_persona_demog);

    } else {
        // --- Handle Regular Cell Click ---
        title = `Examples: ${clickData.sub} (SUB) vs ${clickData.res} (RES)`;
        modalCurrentData = rawData.filter(row =>
            filterConditions(row) && // Apply base model/power filter
            row.sub_persona_demog === clickData.sub &&
            row.res_persona_demog === clickData.res
        );
    }

    // --- Common Modal Population Logic ---
    if (modalCurrentData.length === 0) {
        alert("No underlying raw data found for this selection.");
        return;
    }

    modalItemsShown = Math.min(ITEMS_PER_LOAD, modalCurrentData.length);
    modalTitle.textContent = title; // Set calculated title
    modalBody.innerHTML = generateDetailsHtml(modalCurrentData.slice(0, modalItemsShown), 0); // Generate initial HTML
    modalLoadMoreBtn.style.display = modalCurrentData.length > modalItemsShown ? 'block' : 'none'; // Show/hide load more
    modalContent.scrollTop = 0; // Scroll to top
    modalOverlay.classList.add('modal-visible'); // Show modal
}

function closeModal() { modalOverlay.classList.remove('modal-visible'); }
function loadMoreModalItems() { const newLimit = Math.min(modalItemsShown + ITEMS_PER_LOAD, modalCurrentData.length); if (newLimit > modalItemsShown) { const newItemsHtml = generateDetailsHtml(modalCurrentData.slice(modalItemsShown, newLimit), modalItemsShown); modalBody.insertAdjacentHTML('beforeend', newItemsHtml); modalItemsShown = newLimit; if (modalItemsShown >= modalCurrentData.length) { modalLoadMoreBtn.style.display = 'none'; } } }

// --- Interactivity Functions ---
function handleInfoLinkClick(event) { /* ... (unchanged) ... */ const target = event.target.closest('.info-link'); if (!target) return; event.preventDefault(); const targetId = target.dataset.targetId; const targetElement = document.getElementById(targetId); if (targetElement) { if (targetElement.classList.contains('collapsible-section') && !targetElement.classList.contains('visible')) { toggleSectionVisibility(targetId, true); } document.querySelectorAll('.highlight').forEach(el => el.classList.remove('highlight')); let elementToScrollTo = targetElement; if (target.dataset.highlightScenario) { const scenarioEl = document.getElementById(`scenario-${target.dataset.highlightScenario}`); if (scenarioEl) { scenarioEl.classList.add('highlight'); elementToScrollTo = scenarioEl; } } else if (target.dataset.highlightIdentity && targetId.startsWith('demographic-')) { const axisDiv = document.getElementById(targetId); if(axisDiv){ const identityText = target.dataset.highlightIdentity; const listItems = axisDiv.querySelectorAll('li'); listItems.forEach(li => { if(li.textContent.trim() === identityText){ li.classList.add('highlight'); } }); } } else if (target.dataset.highlightType === 'section') { targetElement.classList.add('highlight'); } elementToScrollTo.scrollIntoView({ behavior: 'smooth', block: 'center' }); document.querySelectorAll('.highlight').forEach(el => { setTimeout(() => el.classList.remove('highlight'), 1500); }); } else { console.warn("Target element not found:", targetId); } }
function toggleSectionVisibility(targetId, forceShow = null) { /* ... (unchanged) ... */ const targetElement = document.getElementById(targetId); const mainButton = globalControlsDiv.querySelector(`.toggle-button[data-target="${targetId}"]`); if (!targetElement) return; let isVisible; if (forceShow !== null) { isVisible = forceShow; targetElement.classList.toggle('visible', isVisible); } else { isVisible = targetElement.classList.toggle('visible'); } if (mainButton) { mainButton.textContent = isVisible ? mainButton.textContent.replace('Show', 'Hide') : mainButton.textContent.replace('Hide', 'Show'); } handleScroll(); }
function handleScroll() { /* ... (unchanged) ... */ document.querySelectorAll('.collapsible-section.visible .sticky-close-button').forEach(button => { const section = button.closest('.collapsible-section'); if (!section) return; const sectionTop = section.getBoundingClientRect().top; button.classList.toggle('is-sticky', sectionTop < 10); }); }


// --- Initial Load and Event Listeners ---
async function initializeApp() {
    try {
        // 1. Load models index
        console.log(`Loading models index from ${MODELS_INDEX_PATH}...`); const modelsInfo = await d3.json(MODELS_INDEX_PATH); uniqueModels = modelsInfo.models.sort(); modelFilenameStems = modelsInfo.filename_stems; console.log(`Found ${uniqueModels.length} models listed in index.`); if (uniqueModels.length === 0) throw new Error("No models listed in index.");

        // 2. Load individual model CSVs
        const loadPromises = uniqueModels.map(model => { const filenameStem = modelFilenameStems[model]; if (!filenameStem) { console.warn(`No filename stem for ${model}. Skipping.`); return Promise.resolve([]); } const filePath = `${SPLIT_DATA_DIR}/${filenameStem}_data.csv`; console.log(`  Queueing load for: ${filePath}`); return d3.csv(filePath, parseRow).catch(error => { console.error(`Failed to load ${filePath}:`, error); return []; }); });
        console.log("Loading all model data CSVs..."); const results = await Promise.all(loadPromises); console.log("Finished loading CSVs.");

        // 3. Combine and process data
        rawData = results.flat(); console.log(`Successfully combined data. Total rows: ${rawData.length}`); rawData = rawData.filter(d => d.model_abbrv && d.sub_persona_demog && d.res_persona_demog && !isNaN(d.power_differential) && (!isNaN(d.cosine_dist_from_no_demog) || !isNaN(d.score)) && d.scenario && d.contextual_dim && d.demographic_dim); console.log(`Rows after final filtering: ${rawData.length}`); if (rawData.length === 0) throw new Error("No valid data loaded.");

        // 4. Extract Unique Scenarios & Demographics (and build scenario text map)
        const scenarioMap = new Map(); const demogMap = {};
        rawData.forEach(d => {
            const scenarioKey = d.final_scenario_id ?? d.scenario_id;
            if (!scenarioMap.has(scenarioKey)) { scenarioMap.set(scenarioKey, { id: scenarioKey, text: d.scenario, context: d.contextual_dim, power: d.power_differential }); }
            // Build scenario text map
            if (d.scenario && !scenarioTextMap.has(scenarioKey)) { scenarioTextMap.set(scenarioKey, { text: d.scenario }); }
            const axis = d.demographic_dim; if (axis) { if (!demogMap[axis]) demogMap[axis] = new Set(); if (d.sub_persona_demog) demogMap[axis].add(d.sub_persona_demog); if (d.res_persona_demog) demogMap[axis].add(d.res_persona_demog); }
        });
        uniqueScenarios = Array.from(scenarioMap.values()); for(const axis in demogMap) { demographicsStructure[axis] = Array.from(demogMap[axis]); }

        // 5. Populate UI
        populateScenarioList(); populateDemographicsList(); aggregatedData = preAggregateData(rawData); modelSelect.selectAll('option').data(uniqueModels).enter().append('option').text(d => d).attr('value', d => d);

        // Populate Overall Findings Averages
        if (avgMetricNoPdSpan && avgMetricPdSpan) { let totalCosNoPd = 0, countCosNoPd = 0, totalScoreNoPd = 0, countScoreNoPd = 0; let totalCosPd = 0, countCosPd = 0, totalScorePd = 0, countScorePd = 0; rawData.forEach(d => { if (d.power_differential === 0) { if (!isNaN(d.cosine_dist_from_no_demog)) { totalCosNoPd += d.cosine_dist_from_no_demog; countCosNoPd++; } if (!isNaN(d.score)) { totalScoreNoPd += d.score; countScoreNoPd++; } } else if (d.power_differential === 1) { if (!isNaN(d.cosine_dist_from_no_demog)) { totalCosPd += d.cosine_dist_from_no_demog; countCosPd++; } if (!isNaN(d.score)) { totalScorePd += d.score; countScorePd++; } } }); const avgCosNoPd = countCosNoPd > 0 ? (totalCosNoPd / countCosNoPd).toFixed(3) : 'N/A'; const avgScoreNoPd = countScoreNoPd > 0 ? (totalScoreNoPd / countScoreNoPd).toFixed(3) : 'N/A'; const avgCosPd = countCosPd > 0 ? (totalCosPd / countCosPd).toFixed(3) : 'N/A'; const avgScorePd = countScorePd > 0 ? (totalScorePd / countScorePd).toFixed(3) : 'N/A'; avgMetricNoPdSpan.innerHTML = `No Power Disparity (Avg Cos: ${avgCosNoPd}, Avg WR: ${avgScoreNoPd})`; avgMetricPdSpan.innerHTML = `Power Disparity (Avg Cos: ${avgCosPd}, Avg WR: ${avgScorePd})`; }

        // 6. Setup Event Listeners
        modelSelect.on('change', updateVisualization); metricSelect.on('change', updateVisualization); powerSelect.on('change', updateVisualization);
        globalControlsDiv.addEventListener('click', (event) => { if (event.target.classList.contains('toggle-button')) { toggleSectionVisibility(event.target.dataset.target); } else if (event.target.classList.contains('inline-toggle')) { const targetId = event.target.dataset.target; toggleSectionVisibility(targetId); const targetElement = document.getElementById(targetId); if(targetElement && targetElement.classList.contains('visible')) { targetElement.scrollIntoView({ behavior: 'smooth', block: 'start' }); } } });
        document.querySelectorAll('.sticky-close-button').forEach(button => { button.addEventListener('click', (event) => { toggleSectionVisibility(event.target.dataset.target, false); }); });
        scenarioFilterInput.addEventListener('input', filterScenarios);
        document.body.addEventListener('click', handleInfoLinkClick);
        modalCloseBtn.addEventListener('click', closeModal);
        modalLoadMoreBtn.addEventListener('click', loadMoreModalItems);
        modalOverlay.addEventListener('click', (event) => { if (event.target === modalOverlay) { closeModal(); } });
        window.addEventListener('scroll', handleScroll);

        // ** NEW: Make interpretations visible by default **
        toggleSectionVisibility('heatmap-interpretations', true); // Force show on load

        // 7. Initial Plot Render
        updateVisualization();

    } catch (error) { /* ... (error handling unchanged) ... */ console.error("Error initializing application:", error); plotlyDiv.innerHTML = (`<p style="color: red; font-weight: bold;">Failed to initialize application. Check console.</p>`); interpretationsContent.innerHTML="<p>Could not initialize application.</p>"; modelSelect.property('disabled',true); metricSelect.property('disabled',true); powerSelect.property('disabled',true); }
}

// --- Start the Application ---
initializeApp();