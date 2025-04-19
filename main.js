// --- Configuration ---
const SPLIT_DATA_DIR = 'data/split_by_model';
const MODELS_INDEX_PATH = `${SPLIT_DATA_DIR}/models.json`; // Path to the generated JSON
const plotlyDivId = 'plotly-heatmap';
const ITEMS_PER_LOAD = 5; // How many examples to show/load at a time in modal
const LUMINANCE_THRESHOLD = 0.5; // Threshold for switching text color
const DEFAULT_COSINE_MIN = 0.0; // Default if no data found
const DEFAULT_COSINE_MAX = 0.3; // Default if no data found

// --- Selectors ---
const modelSelect = d3.select('#model-select');
const metricSelect = d3.select('#metric-select');
const powerSelect = d3.select('#power-select');
const globalControlsDiv = document.getElementById('global-controls');
const preambleDiv = document.getElementById('preamble');
const scenariosContainer = document.getElementById('scenarios-list-container');
const scenariosListDiv = document.getElementById('scenarios-list');
const scenarioCountSpan = document.getElementById('scenario-count');
const scenarioFilterInput = document.getElementById('scenario-filter');
const demographicsContainer = document.getElementById('demographics-list-container');
const demographicsListDiv = document.getElementById('demographics-list');
const modalOverlay = document.getElementById('modal-overlay');
const modalContent = document.getElementById('modal-content');
const modalTitle = document.getElementById('modal-title');
const modalBody = document.getElementById('modal-body');
const modalCloseBtn = document.getElementById('modal-close'); // The fixed 'X' button
const modalLoadMoreBtn = document.getElementById('modal-load-more');
const plotlyDiv = document.getElementById(plotlyDivId);

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

// --- Plotly Color Scales ---
const cosineColorScale = 'Viridis'; // Plotly named scale
const winRateColorScale = [[0, 'crimson'], [0.5, 'grey'], [1, 'lime']]; // Custom scale

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
        final_scenario_id: +d.final_scenario_id,
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
        // Secondary sort alphabetically
        if (a < b) return -1;
        if (a > b) return 1;
        return 0;
    });
    return labels;
}

/**
 * Pre-aggregates raw data into averages for faster heatmap generation.
 * @param {Array} data - The combined raw dataset
 * @returns {object} Aggregated data object
 */
function preAggregateData(data) {
    console.log("Pre-aggregating data...");
    const aggregation = {};
    // uniqueModels should already be populated from initializeApp
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
            if (!aggregation[model]['all'][key]) {
                aggregation[model]['all'][key] = { cosSum: 0, cosCount: 0, scoreSum: 0, scoreCount: 0 };
            }
            if (!aggregation[model][power][key]) {
                aggregation[model][power][key] = { cosSum: 0, cosCount: 0, scoreSum: 0, scoreCount: 0 };
            }

            // Accumulate sums and counts for 'all' power filter
            if (!isNaN(row.cosine_dist_from_no_demog)) {
                aggregation[model]['all'][key].cosSum += row.cosine_dist_from_no_demog;
                aggregation[model]['all'][key].cosCount++;
                aggregation[model][power][key].cosSum += row.cosine_dist_from_no_demog; // Accumulate for specific power too
                aggregation[model][power][key].cosCount++;
            }
            if (!isNaN(row.score)) {
                aggregation[model]['all'][key].scoreSum += row.score;
                aggregation[model]['all'][key].scoreCount++;
                aggregation[model][power][key].scoreSum += row.score; // Accumulate for specific power too
                aggregation[model][power][key].scoreCount++;
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
        if (colorStr.length === 4) { // Handle #rgb shorthand
            r = parseInt(colorStr[1] + colorStr[1], 16);
            g = parseInt(colorStr[2] + colorStr[2], 16);
            b = parseInt(colorStr[3] + colorStr[3], 16);
        } else if (colorStr.length === 7) { // Handle #rrggbb
            const bigint = parseInt(colorStr.slice(1), 16);
            r = (bigint >> 16) & 255;
            g = (bigint >> 8) & 255;
            b = bigint & 255;
        }
    } else if (colorStr.startsWith('rgb')) {
        const match = colorStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (match) {
            r = parseInt(match[1], 10);
            g = parseInt(match[2], 10);
            b = parseInt(match[3], 10);
        }
    }
    // Add more robust parsing if needed (e.g., HSL, color names)
    return { r, g, b };
}

/**
 * Calculates perceived luminance (Y) from an RGB color object.
 * Uses the formula for sRGB luminance.
 * @param {object} rgb - Object with r, g, b properties (0-255)
 * @returns {number} Luminance value between 0 (black) and 1 (white)
 */
function getLuminance(rgb) {
    // Convert 0-255 range to 0-1 range and apply gamma correction inverse
    const RsRGB = rgb.r / 255;
    const GsRGB = rgb.g / 255;
    const BsRGB = rgb.b / 255;

    const R = (RsRGB <= 0.03928) ? RsRGB / 12.92 : Math.pow(((RsRGB + 0.055) / 1.055), 2.4);
    const G = (GsRGB <= 0.03928) ? GsRGB / 12.92 : Math.pow(((GsRGB + 0.055) / 1.055), 2.4);
    const B = (BsRGB <= 0.03928) ? BsRGB / 12.92 : Math.pow(((BsRGB + 0.055) / 1.055), 2.4);

    // Calculate luminance using standard coefficients
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
    // Handle edge case where min and max are the same
    if (range <= 0) {
        if (typeof colorscale === 'string') return '#808080'; // Default grey for named scale error
        return colorscale[0]?.[1] || '#808080'; // Return first color or grey
    }

    const normalizedValue = Math.max(0, Math.min(1, (value - zmin) / range));

    let scaleToUse;
    // Handle Plotly named scales (approximations needed)
    if (typeof colorscale === 'string') {
        // Note: Proper mapping requires a library or extensive manual definition.
        if (colorscale.toLowerCase() === 'viridis') {
            scaleToUse = [[0, 'rgb(68,1,84)'], [0.25, 'rgb(59,82,139)'], [0.5, 'rgb(33,145,140)'], [0.75, 'rgb(94,201,98)'], [1, 'rgb(253,231,37)']];
        } else { // Default simple scale for other named scales
            scaleToUse = [[0, 'rgb(0,0,255)'], [1, 'rgb(255,0,0)']];
        }
    } else {
        scaleToUse = colorscale; // Assume array format [[val, color], ...]
    }

    // Find the two colors in the scale to interpolate between
    let lowerBound = scaleToUse[0];
    let upperBound = scaleToUse[scaleToUse.length - 1];
    for (let i = 0; i < scaleToUse.length - 1; i++) {
        if (normalizedValue >= scaleToUse[i][0] && normalizedValue <= scaleToUse[i + 1][0]) {
            lowerBound = scaleToUse[i];
            upperBound = scaleToUse[i + 1];
            break;
        }
    }

    // Interpolate between the lower and upper bound colors
    const scaleRange = upperBound[0] - lowerBound[0];
    const scaleFraction = scaleRange === 0 ? 0 : (normalizedValue - lowerBound[0]) / scaleRange;

    const lowerColor = parseColor(lowerBound[1]);
    const upperColor = parseColor(upperBound[1]);

    // Linear interpolation in RGB space
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
            if (s.power === 1) {
                html += `<span class="pd-tag">(Power Disparity)</span>`;
            }
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
        // Create an ID friendly version of the axis name
        const axisId = axis.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-]/g, '');
        html += `<div class="demographic-axis" id="demographic-${axisId}">`;
        html += `<h3>${axis}</h3>`;
        html += `<ul>`;
        demographicsStructure[axis].sort().forEach(identity => {
            html += `<li>${identity}</li>`;
        });
        html += `</ul>`;
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
        if (filterText === '') {
            isVisible = true; // Show all if filter empty
        } else if (isFilteringById && scenarioId === filterText) {
            isVisible = true; // Exact ID match
        } else if (!isFilteringById && (scenarioText.includes(filterText) || context.includes(filterText))) {
            isVisible = true; // Text match in scenario or context
        }

        item.style.display = isVisible ? '' : 'none';
        item.classList.toggle('highlight', isVisible && filterText !== ''); // Highlight if visible due to filter
    });
}


// --- Plotting Function ---

/** Updates the Plotly heatmap visualization */
function updateVisualization() {
    const selectedModel = modelSelect.node().value;
    const selectedMetricKey = metricSelect.node().value;
    const selectedPowerFilter = powerSelect.node().value;

    // Get pre-aggregated data for the current selection
    const modelPowerAggData = aggregatedData[selectedModel]?.[selectedPowerFilter];

    // Handle cases with no data
    if (!modelPowerAggData || Object.keys(modelPowerAggData).length === 0) {
        Plotly.purge(plotlyDivId); // Clear existing plot
        plotlyDiv.innerHTML = "<p>No data available for this selection.</p>";
        closeModal(); // Ensure modal is closed if plot is cleared
        return;
    }

    // --- ** NEW: Calculate Dynamic Cosine Distance Range ** ---
    let dynamicZmin = DEFAULT_COSINE_MIN;
    let dynamicZmax = DEFAULT_COSINE_MAX;

    if (selectedMetricKey === 'cosine_dist_from_no_demog') {
        let minCos = Infinity;
        let maxCos = -Infinity;
        let foundValue = false;

        Object.values(modelPowerAggData).forEach(entry => {
            const cosValue = entry.avgCos;
            if (cosValue !== null && !isNaN(cosValue)) {
                minCos = Math.min(minCos, cosValue);
                maxCos = Math.max(maxCos, cosValue);
                foundValue = true;
            }
        });

        if (foundValue) {
            // Round min down to nearest 0.05, ensuring it's >= 0
            dynamicZmin = Math.max(0, Math.floor(minCos / 0.05) * 0.05);
            // Round max up to nearest 0.05
            dynamicZmax = Math.ceil(maxCos / 0.05) * 0.05;
            // Ensure max is always at least slightly greater than min
            if (dynamicZmax <= dynamicZmin) {
                dynamicZmax = dynamicZmin + 0.05;
            }
             console.log(`Dynamic Cosine Range for ${selectedModel} (${selectedPowerFilter}): [${dynamicZmin.toFixed(2)}, ${dynamicZmax.toFixed(2)}]`);
        } else {
            console.log(`No valid cosine data for ${selectedModel} (${selectedPowerFilter}), using default range.`);
            // Keep default values if no valid data found
        }
    }
    // --- End Dynamic Range Calculation ---


    // Determine metric info (key, label, scale, range)
    if (selectedMetricKey === 'cosine_dist_from_no_demog') {
        currentMetricInfo = {
            key: 'avgCos',
            label: 'Avg Cosine Distance',
            colorscale: cosineColorScale,
            zmin: dynamicZmin, // Use calculated dynamic min
            zmax: dynamicZmax  // Use calculated dynamic max
        };
    } else { // score (Win Rate)
        currentMetricInfo = {
            key: 'avgScore',
            label: 'Avg Win Rate',
            colorscale: winRateColorScale,
            zmin: 0, // Fixed range for win rate
            zmax: 1
        };
    }

    // --- Prepare Data for Plotly ---
    // Extract unique labels and demographic mappings for sorting
    const currentKeys = Object.keys(modelPowerAggData);
    const currentSubLabelsSet = new Set(currentKeys.map(k => k.split('||')[0]));
    const currentResLabelsSet = new Set(currentKeys.map(k => k.split('||')[1]));
    const relevantRawData = rawData.filter(d => d.model_abbrv === selectedModel && (selectedPowerFilter === 'all' || String(d.power_differential) === selectedPowerFilter) && currentSubLabelsSet.has(d.sub_persona_demog) && currentResLabelsSet.has(d.res_persona_demog));
    const demographicDimMap = {};
    relevantRawData.forEach(d => {
        if (d.sub_persona_demog && d.demographic_dim) demographicDimMap[d.sub_persona_demog] = d.demographic_dim;
        if (d.res_persona_demog && d.demographic_dim) demographicDimMap[d.res_persona_demog] = d.demographic_dim;
    });
    const sortedSubLabels = getSortedLabels(relevantRawData, 'sub_persona_demog', demographicDimMap);
    const sortedResLabels = getSortedLabels(relevantRawData, 'res_persona_demog', demographicDimMap);

    // Define labels including means
    const subMeanLabel = 'RES Mean across all SUB';
    const resMeanLabel = 'SUB Mean across all RES';
    const yLabelsOriginalOrder = [...sortedSubLabels, subMeanLabel];
    const xLabels = [...sortedResLabels, resMeanLabel];

    // Initialize matrices for Plotly data (z, hover text, custom data)
    const zValuesOriginalOrder = Array(yLabelsOriginalOrder.length).fill(null).map(() => Array(xLabels.length).fill(NaN));
    const hoverTextOriginalOrder = Array(yLabelsOriginalOrder.length).fill(null).map(() => Array(xLabels.length).fill(''));
    const customDataOriginalOrder = Array(yLabelsOriginalOrder.length).fill(null).map(() => Array(xLabels.length).fill(null));
    const yIndexMap = new Map(yLabelsOriginalOrder.map((lbl, i) => [lbl, i]));
    const xIndexMap = new Map(xLabels.map((lbl, i) => [lbl, i]));

    // Populate matrices for non-mean cells
    for (const key in modelPowerAggData) {
        const [sub, res] = key.split('||');
        const dataPoint = modelPowerAggData[key];
        const metricValue = dataPoint[currentMetricInfo.key];
        const count = dataPoint.count;
        const rowIndex = yIndexMap.get(sub);
        const colIndex = xIndexMap.get(res);

        if (rowIndex !== undefined && colIndex !== undefined) {
            const displayValue = isNaN(metricValue) ? null : metricValue;
            zValuesOriginalOrder[rowIndex][colIndex] = displayValue;
            hoverTextOriginalOrder[rowIndex][colIndex] = `<b>SUB:</b> ${sub}<br><b>RES:</b> ${res}<br><b>${currentMetricInfo.label}:</b> ${displayValue === null ? 'N/A' : displayValue.toFixed(3)}<br><b>Count:</b> ${count}`;
            customDataOriginalOrder[rowIndex][colIndex] = { sub: sub, res: res, value: metricValue, count: count, isMean: false };
        }
    }

    // Calculate and add means (Row, Column, Grand)
    const rowMeanIndex = yIndexMap.get(subMeanLabel);
    const colMeanIndex = xIndexMap.get(resMeanLabel);
    // Row means
    for (let i = 0; i < sortedSubLabels.length; i++) {
        const sub = sortedSubLabels[i]; let sum = 0, totalCount = 0;
        for (let j = 0; j < sortedResLabels.length; j++) { const res = sortedResLabels[j]; const key = `${sub}||${res}`; if (modelPowerAggData[key]) { const val = modelPowerAggData[key][currentMetricInfo.key]; const cnt = modelPowerAggData[key].count; if (!isNaN(val) && cnt > 0) { sum += val * cnt; totalCount += cnt; } } }
        const mean = totalCount > 0 ? sum / totalCount : NaN; const displayMean = isNaN(mean) ? null : mean;
        zValuesOriginalOrder[i][colMeanIndex] = displayMean; hoverTextOriginalOrder[i][colMeanIndex] = `<b>SUB:</b> ${sub}<br><b>RES:</b> Mean<br><b>${currentMetricInfo.label}:</b> ${displayMean === null ? 'N/A' : displayMean.toFixed(3)}`; customDataOriginalOrder[i][colMeanIndex] = { sub: sub, res: resMeanLabel, value: mean, isMean: true, meanType: 'row' };
    }
    // Column means
    for (let j = 0; j < sortedResLabels.length; j++) {
        const res = sortedResLabels[j]; let sum = 0, totalCount = 0;
        for (let i = 0; i < sortedSubLabels.length; i++) { const sub = sortedSubLabels[i]; const key = `${sub}||${res}`; if (modelPowerAggData[key]) { const val = modelPowerAggData[key][currentMetricInfo.key]; const cnt = modelPowerAggData[key].count; if (!isNaN(val) && cnt > 0) { sum += val * cnt; totalCount += cnt; } } }
        const mean = totalCount > 0 ? sum / totalCount : NaN; const displayMean = isNaN(mean) ? null : mean;
        zValuesOriginalOrder[rowMeanIndex][j] = displayMean; hoverTextOriginalOrder[rowMeanIndex][j] = `<b>SUB:</b> Mean<br><b>RES:</b> ${res}<br><b>${currentMetricInfo.label}:</b> ${displayMean === null ? 'N/A' : displayMean.toFixed(3)}`; customDataOriginalOrder[rowMeanIndex][j] = { sub: subMeanLabel, res: res, value: mean, isMean: true, meanType: 'column' };
    }
    // Grand mean
    let grandSum = 0, grandCount = 0; for (const key in modelPowerAggData) { const val = modelPowerAggData[key][currentMetricInfo.key]; const cnt = modelPowerAggData[key].count; if (!isNaN(val) && cnt > 0) { grandSum += val * cnt; grandCount += cnt; } }
    const grandMean = grandCount > 0 ? grandSum / grandCount : NaN; const displayGrandMean = isNaN(grandMean) ? null : grandMean;
    zValuesOriginalOrder[rowMeanIndex][colMeanIndex] = displayGrandMean; hoverTextOriginalOrder[rowMeanIndex][colMeanIndex] = `<b>SUB:</b> Mean<br><b>RES:</b> Mean<br><b>${currentMetricInfo.label}:</b> ${displayGrandMean === null ? 'N/A' : displayGrandMean.toFixed(3)}`; customDataOriginalOrder[rowMeanIndex][colMeanIndex] = { sub: subMeanLabel, res: resMeanLabel, value: grandMean, isMean: true, meanType: 'grand' };

    // Flip Y-axis data for correct visual representation
    const yLabels = [...yLabelsOriginalOrder].reverse();
    const zValues = [...zValuesOriginalOrder].reverse();
    const hoverText = [...hoverTextOriginalOrder].reverse();
    const customData = [...customDataOriginalOrder].reverse();

    // --- Define Plotly Trace (Heatmap only) ---
    const trace = {
        z: zValues,
        x: xLabels,
        y: yLabels,
        type: 'heatmap',
        colorscale: currentMetricInfo.colorscale,
        zmin: currentMetricInfo.zmin,
        zmax: currentMetricInfo.zmax,
        hoverongaps: false,
        text: hoverText,       // Provide hover text data
        hoverinfo: 'text',     // Use the 'text' data for hover tooltips
        customdata: customData, // Data passed to click events
        showscale: true,       // Show the color bar legend
        colorbar: {
            title: { text: currentMetricInfo.label, side: 'right' }
        }
        // No texttemplate or textfont here; text is done via annotations
    };

    // --- Calculate Annotations for cell text ---
    const annotations = [];
    for (let i = 0; i < yLabels.length; i++) { // Use flipped Y labels/data
        for (let j = 0; j < xLabels.length; j++) {
            const value = zValues[i][j]; // Use flipped Z value
            if (value !== null && !isNaN(value)) {
                // Determine appropriate text color based on cell background
                const bgColor = getColorForValue(value, currentMetricInfo.zmin, currentMetricInfo.zmax, currentMetricInfo.colorscale);
                const luminance = getLuminance(parseColor(bgColor));
                const textColor = luminance > LUMINANCE_THRESHOLD ? 'black' : 'white';

                annotations.push({
                    x: xLabels[j],        // X coordinate (Res Persona)
                    y: yLabels[i],        // Y coordinate (Sub Persona)
                    text: value.toFixed(2), // Display value formatted to 2 decimals
                    showarrow: false,     // No arrow needed
                    font: {
                        family: 'Arial, sans-serif', // Font family
                        size: 14,          // Font size for cell text
                        color: textColor, // Dynamically determined text color
                        weight: 'bold'    // Make cell text bold
                    }
                });
            }
        }
    }

    // --- Define Plotly Layout ---
    const layout = {
        title: `Heatmap of ${currentMetricInfo.label} for Model: ${selectedModel}<br>(Power Disparity: ${selectedPowerFilter === 'all' ? 'All' : (selectedPowerFilter === '1' ? 'Present' : 'Absent')})`,
        xaxis: {
            title: 'Responder Persona Demographic (RES)',
            tickangle: -45,
            automargin: true,
            tickvals: xLabels, // Explicit ticks
            ticktext: xLabels.map(lbl => lbl.includes('Mean') ? `<i><b>${lbl}</b></i>` : lbl) // Style mean labels
        },
        yaxis: {
            title: 'Subject Persona Demographic (SUB)',
            automargin: true,
            tickvals: yLabels, // Explicit ticks (flipped order)
            ticktext: yLabels.map(lbl => lbl.includes('Mean') ? `<i><b>${lbl}</b></i>` : lbl) // Style mean labels
        },
        margin: { l: 200, r: 50, b: 150, t: 100, pad: 4 },
        autosize: true,
        annotations: annotations // Add the calculated annotations
    };

    // --- Plotly Configuration ---
    const config = {
        responsive: true,
        displaylogo: false,
        modeBarButtonsToRemove: ['select2d', 'lasso2d', 'zoomIn2d', 'zoomOut2d', 'autoScale2d', 'resetScale2d']
    };

    // --- Create/Update Plot ---
    Plotly.newPlot(plotlyDivId, [trace], layout, config);

    // --- Attach Click Handler for Modal ---
    plotlyDiv.removeAllListeners('plotly_click'); // Clear previous listeners
    plotlyDiv.on('plotly_click', (data) => {
        if (data.points.length > 0) {
            const pointData = data.points[0];
            const clickedCustomData = pointData.customdata; // Get data stored in customdata
            if (clickedCustomData && !clickedCustomData.isMean) {
                // Open the modal with data for the clicked cell
                openModal(selectedModel, clickedCustomData.sub, clickedCustomData.res, selectedPowerFilter);
            } else if (clickedCustomData && clickedCustomData.isMean) {
                console.log("Mean cell clicked - no details available.");
            }
        }
    });
}


// --- Modal Functions ---

/**
 * Generates HTML for displaying example details within the modal.
 * @param {Array} dataToShow - Array of raw data rows to display.
 * @returns {string} HTML string.
 */
function generateDetailsHtml(dataToShow) {
    let detailsHtml = '';
    dataToShow.forEach((row, index) => {
        const scenarioLink = `<span class="info-link" data-target-id="scenarios-list-container" data-highlight-scenario="${row.scenario_id}">${row.scenario_id}</span>`;
        const subDemogLink = `<span class="info-link" data-target-id="demographic-${row.demographic_dim?.replace(/\s+/g, '-')}" data-highlight-identity="${row.sub_persona_demog}">${row.sub_persona_demog}</span>`;
        const resDemogLink = `<span class="info-link" data-target-id="demographic-${row.demographic_dim?.replace(/\s+/g, '-')}" data-highlight-identity="${row.res_persona_demog}">${row.res_persona_demog}</span>`;
        detailsHtml += `
            <div>
                <p><strong>Sample ${index + 1} of ${modalCurrentData.length}</strong></p>
                <p><strong>Scenario ID:</strong> ${scenarioLink}</p>
                <p><strong>Power Diff:</strong> ${row.power_differential === 1 ? 'Present (1)' : 'Absent (0)'}</p>
                <p><strong>SUB Persona:</strong> ${subDemogLink}</p>
                <p><strong>RES Persona:</strong> ${resDemogLink}</p>
                <p><strong>Demog Response:</strong> <span class="modal-response demog-resp">${row.response || '(No Response)'}</span></p>
                <p><strong>Non-Demog Resp:</strong> <span class="modal-response baseline-resp">${row.response_non_demog || '(No Response)'}</span></p>
                <p><strong>Cosine Dist:</strong> <span class="metric-value cosine-value">${row.cosine_dist_from_no_demog?.toFixed(4) ?? 'N/A'}</span></p>
                <p><strong>Win Rate (Score):</strong> <span class="metric-value winrate-value">${row.score?.toFixed(2) ?? 'N/A'}</span></p>
            </div>
        `;
    });
    return detailsHtml;
}

/**
 * Opens the modal and populates it with initial details.
 * @param {string} model - Selected model name.
 * @param {string} subPersona - Subject persona identity.
 * @param {string} resPersona - Responder persona identity.
 * @param {string} powerFilter - Current power disparity filter ('all', '0', '1').
 */
function openModal(model, subPersona, resPersona, powerFilter) {
    // Filter raw data for the specific cell clicked
    modalCurrentData = rawData.filter(row =>
        row.model_abbrv === model &&
        row.sub_persona_demog === subPersona &&
        row.res_persona_demog === resPersona &&
        (powerFilter === 'all' || String(row.power_differential) === powerFilter)
    );

    if (modalCurrentData.length === 0) {
        alert("No underlying raw data found for this specific combination.");
        return;
    }

    // Reset display state
    modalItemsShown = Math.min(ITEMS_PER_LOAD, modalCurrentData.length);

    // Populate modal
    modalTitle.textContent = `Examples: ${subPersona} (SUB) vs ${resPersona} (RES)`;
    modalBody.innerHTML = generateDetailsHtml(modalCurrentData.slice(0, modalItemsShown));

    // Show/hide 'Load More' button
    modalLoadMoreBtn.style.display = modalCurrentData.length > modalItemsShown ? 'block' : 'none';

    // Reset scroll position of modal content
    modalContent.scrollTop = 0;

    // Make the modal visible
    modalOverlay.classList.add('modal-visible');
}

/** Closes the modal overlay. */
function closeModal() {
    modalOverlay.classList.remove('modal-visible');
}

/** Loads and appends more example items into the modal body. */
function loadMoreModalItems() {
    const newLimit = Math.min(modalItemsShown + ITEMS_PER_LOAD, modalCurrentData.length);
    if (newLimit > modalItemsShown) {
        // Generate HTML only for the new items
        const newItemsHtml = generateDetailsHtml(modalCurrentData.slice(modalItemsShown, newLimit));
        // Append new items to the modal body
        modalBody.insertAdjacentHTML('beforeend', newItemsHtml);
        modalItemsShown = newLimit;

        // Hide 'Load More' button if all items are now shown
        if (modalItemsShown >= modalCurrentData.length) {
            modalLoadMoreBtn.style.display = 'none';
        }
    }
}


// --- Interactivity Functions ---

/**
 * Handles clicks on elements with the 'info-link' class, scrolling to and highlighting targets.
 * @param {Event} event - The click event object.
 */
function handleInfoLinkClick(event) {
    const target = event.target.closest('.info-link');
    if (!target) return; // Exit if click wasn't on or inside an info-link

    event.preventDefault(); // Prevent default link navigation

    const targetId = target.dataset.targetId;
    const targetElement = document.getElementById(targetId);

    if (targetElement) {
        // Ensure the target section is visible before scrolling
        if (targetElement.classList.contains('collapsible-section') && !targetElement.classList.contains('visible')) {
            toggleSectionVisibility(targetId, true); // Force show the section
        }

        // Clear previous highlights from all lists/sections
        document.querySelectorAll('.highlight').forEach(el => el.classList.remove('highlight'));

        let elementToScrollTo = targetElement; // Default to scrolling to the section itself

        // --- Apply Specific Highlighting ---
        if (target.dataset.highlightScenario) {
            const scenarioEl = document.getElementById(`scenario-${target.dataset.highlightScenario}`);
            if (scenarioEl) {
                scenarioEl.classList.add('highlight');
                elementToScrollTo = scenarioEl; // Scroll to the specific scenario item
            }
        } else if (target.dataset.highlightIdentity && targetId.startsWith('demographic-')) {
            const axisDiv = document.getElementById(targetId);
            if (axisDiv) {
                const identityText = target.dataset.highlightIdentity;
                const listItems = axisDiv.querySelectorAll('li');
                listItems.forEach(li => {
                    if (li.textContent.trim() === identityText) {
                        li.classList.add('highlight');
                        // Keep elementToScrollTo as the axis container in this case
                    }
                });
            }
        } else if (target.dataset.highlightType === 'section') {
            targetElement.classList.add('highlight'); // Highlight the whole section briefly
        }
        // --- End Highlighting Logic ---

        // Scroll the target element into view
        elementToScrollTo.scrollIntoView({ behavior: 'smooth', block: 'center' }); // 'center' often feels better

        // Flash the highlight briefly
        document.querySelectorAll('.highlight').forEach(el => {
            setTimeout(() => el.classList.remove('highlight'), 1500); // Remove after 1.5 seconds
        });

    } else {
        console.warn("Target element not found for info link:", targetId);
    }
}

/**
 * Toggles the visibility of a collapsible section and updates its control buttons.
 * @param {string} targetId - The ID of the collapsible section.
 * @param {boolean|null} forceShow - If true, force show; if false, force hide; if null, toggle.
 */
function toggleSectionVisibility(targetId, forceShow = null) {
    const targetElement = document.getElementById(targetId);
    const mainButton = globalControlsDiv.querySelector(`.toggle-button[data-target="${targetId}"]`);
    // Note: Sticky button existence is handled by CSS/scroll handler

    if (!targetElement) return;

    let isVisible;
    if (forceShow !== null) {
        isVisible = forceShow;
        targetElement.classList.toggle('visible', isVisible); // Set based on forceShow
    } else {
        isVisible = targetElement.classList.toggle('visible'); // Toggle and get new state
    }

    // Update main toggle button text
    if (mainButton) {
        mainButton.textContent = isVisible ? mainButton.textContent.replace('Show', 'Hide') : mainButton.textContent.replace('Hide', 'Show');
    }

    // Trigger sticky check in case visibility change affects positions
    handleScroll();
}

/** Handles window scroll event to toggle sticky class on relevant buttons. */
function handleScroll() {
    // Check sticky state ONLY for VISIBLE sections' close buttons
    document.querySelectorAll('.collapsible-section.visible .sticky-close-button').forEach(button => {
        const section = button.closest('.collapsible-section');
        if (!section) return;
        const sectionTop = section.getBoundingClientRect().top;
        // Add 'is-sticky' if the top of the section is at or above the threshold (e.g., 10px from viewport top)
        button.classList.toggle('is-sticky', sectionTop < 10);
    });
}


// --- Initial Application Load ---

/** Fetches data and initializes the visualization and event listeners. */
async function initializeApp() {
    try {
        // 1. Load the models index file
        console.log(`Loading models index from ${MODELS_INDEX_PATH}...`);
        const modelsInfo = await d3.json(MODELS_INDEX_PATH);
        uniqueModels = modelsInfo.models.sort();
        modelFilenameStems = modelsInfo.filename_stems;
        console.log(`Found ${uniqueModels.length} models listed in index.`);
        if (uniqueModels.length === 0) throw new Error("No models listed in index.");

        // 2. Create promises to load each model's CSV
        const loadPromises = uniqueModels.map(model => {
            const filenameStem = modelFilenameStems[model];
            if (!filenameStem) {
                console.warn(`No filename stem for model ${model}. Skipping.`);
                return Promise.resolve([]); // Resolve with empty array for this model
            }
            const filePath = `${SPLIT_DATA_DIR}/${filenameStem}_data.csv`;
            console.log(`  Queueing load for: ${filePath}`);
            return d3.csv(filePath, parseRow).catch(error => {
                console.error(`Failed to load ${filePath}:`, error);
                return []; // Resolve with empty array on specific file load failure
            });
        });

        // 3. Load all CSVs in parallel
        console.log("Loading all model data CSVs...");
        const results = await Promise.all(loadPromises);
        console.log("Finished loading CSVs.");

        // 4. Combine results into the main rawData array
        rawData = results.flat(); // Flatten array of arrays into one array
        console.log(`Successfully combined data. Total rows: ${rawData.length}`);

        // Final filtering pass on combined data
        rawData = rawData.filter(d => d.model_abbrv && d.sub_persona_demog && d.res_persona_demog && !isNaN(d.power_differential) && (!isNaN(d.cosine_dist_from_no_demog) || !isNaN(d.score)) && d.scenario && d.contextual_dim && d.demographic_dim);
        console.log(`Rows after final filtering: ${rawData.length}`);
        if (rawData.length === 0) throw new Error("No valid data loaded after combining files.");


        // 5. Extract Unique Scenarios & Demographics from combined data
        const scenarioMap = new Map(); const demogMap = {};
        rawData.forEach(d => {
            const scenarioKey = d.final_scenario_id ?? d.scenario_id; // Use final_id if available
            if (!scenarioMap.has(scenarioKey)) {
                scenarioMap.set(scenarioKey, { id: scenarioKey, text: d.scenario, context: d.contextual_dim, power: d.power_differential });
            }
            const axis = d.demographic_dim;
            if (axis) {
                if (!demogMap[axis]) demogMap[axis] = new Set();
                if (d.sub_persona_demog) demogMap[axis].add(d.sub_persona_demog);
                if (d.res_persona_demog) demogMap[axis].add(d.res_persona_demog);
            }
        });
        uniqueScenarios = Array.from(scenarioMap.values());
        for (const axis in demogMap) { demographicsStructure[axis] = Array.from(demogMap[axis]); }

        // 6. Populate UI Elements (Lists, Dropdown)
        populateScenarioList();
        populateDemographicsList();
        aggregatedData = preAggregateData(rawData); // Pre-aggregate combined data
        modelSelect.selectAll('option').data(uniqueModels).enter().append('option').text(d => d).attr('value', d => d);

        // 7. Setup Event Listeners
        modelSelect.on('change', updateVisualization);
        metricSelect.on('change', updateVisualization);
        powerSelect.on('change', updateVisualization);
        globalControlsDiv.addEventListener('click', (event) => {
            if (event.target.classList.contains('toggle-button')) { toggleSectionVisibility(event.target.dataset.target); }
            else if (event.target.classList.contains('inline-toggle')) { const targetId = event.target.dataset.target; toggleSectionVisibility(targetId); const targetElement = document.getElementById(targetId); if (targetElement && targetElement.classList.contains('visible')) { targetElement.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }
        });
        document.querySelectorAll('.sticky-close-button').forEach(button => { button.addEventListener('click', (event) => { toggleSectionVisibility(event.target.dataset.target, false); }); });
        scenarioFilterInput.addEventListener('input', filterScenarios);
        document.body.addEventListener('click', handleInfoLinkClick);
        modalCloseBtn.addEventListener('click', closeModal);
        modalLoadMoreBtn.addEventListener('click', loadMoreModalItems);
        modalOverlay.addEventListener('click', (event) => { if (event.target === modalOverlay) { closeModal(); } });
        window.addEventListener('scroll', handleScroll);

        // 8. Initial Plot Render
        updateVisualization(); // Render the initial plot

    } catch (error) {
        // Handle errors during initialization
        console.error("Error initializing application:", error);
        plotlyDiv.innerHTML = (`<p style="color: red; font-weight: bold;">Failed to initialize application. Could not load necessary data. Check console for details.</p>`);
        // Disable controls to prevent further errors
        modelSelect.property('disabled', true);
        metricSelect.property('disabled', true);
        powerSelect.property('disabled', true);
    }
}

// --- Start the Application ---
initializeApp(); // Call the initialization function when the script loads