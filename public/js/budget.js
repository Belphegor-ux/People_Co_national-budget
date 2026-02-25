/* ═══════════════════════════════════════════════════════════
   Collective National Budget – Front-End Logic
   ═══════════════════════════════════════════════════════════ */

// Okabe-Ito accessible color palette
const A11Y_COLORS = [
    '#E69F00', '#56B4E9', '#009E73', '#F0E442',
    '#0072B2', '#D55E00', '#CC79A7', '#999999',
    '#1B9E77', '#D95F02', '#7570B3', '#E7298A'
];

// ── State ────────────────────────────────────────────────────
let currentChart  = null;
let currentNodes  = [];
let currentParent = 1;   // Root node
let mode          = 'view';
let isLoggedIn    = false;

// ── Initialization ───────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    await checkAuth();
    await loadTree(1);
    await loadStats();
});

// ══════════════════════════════════════════════════════════════
//  AUTH
// ══════════════════════════════════════════════════════════════

async function checkAuth() {
    try {
        const res = await fetch('/api/me');
        const data = await res.json();
        isLoggedIn = data.logged_in;
        renderAuthArea(data);
    } catch (e) {
        isLoggedIn = false;
        renderAuthArea({ logged_in: false });
    }
}

function renderAuthArea(data) {
    const area = document.getElementById('auth-area');
    const editBtn = document.getElementById('btn-edit');

    if (data.logged_in) {
        area.innerHTML = `
            <span class="user-info">Logged in as <strong>${data.username}</strong></span>
            <button onclick="doLogout()">Log Out</button>
        `;
        editBtn.disabled = false;
    } else {
        area.innerHTML = `<button onclick="openLoginModal()">Log In to Edit</button>`;
        editBtn.disabled = true;
        if (mode === 'edit') switchMode('view');
    }
}

function openLoginModal() {
    document.getElementById('login-modal').style.display = 'flex';
    document.getElementById('login-user').focus();
}

function closeLoginModal() {
    document.getElementById('login-modal').style.display = 'none';
    document.getElementById('login-error').style.display = 'none';
}

async function doLogin() {
    const username = document.getElementById('login-user').value.trim();
    const password = document.getElementById('login-pass').value;

    try {
        const res = await fetch('/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        if (res.ok) {
            closeLoginModal();
            await checkAuth();
            toast('Logged in successfully!', 'success');
        } else {
            const err = await res.json();
            const errEl = document.getElementById('login-error');
            errEl.textContent = err.error || 'Login failed';
            errEl.style.display = 'block';
        }
    } catch (e) {
        toast('Connection error', 'error');
    }
}

async function doLogout() {
    await fetch('/logout', { method: 'POST' });
    isLoggedIn = false;
    switchMode('view');
    await checkAuth();
    toast('Logged out', 'success');
}

// Handle Enter key in login form
document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && document.getElementById('login-modal').style.display === 'flex') {
        doLogin();
    }
});

// ══════════════════════════════════════════════════════════════
//  TREE LOADING & NAVIGATION
// ══════════════════════════════════════════════════════════════

async function loadTree(parentId) {
    currentParent = parentId;

    try {
        const res = await fetch(`/api/tree/${parentId}?mode=${mode}`);
        currentNodes = await res.json();

        if (currentNodes.length === 0) {
            toast('No sub-categories at this level', 'error');
            return;
        }

        renderChart(currentNodes);
        renderEditableLegend(currentNodes);
        await renderBreadcrumbs(parentId);
        updateBackButton();
    } catch (e) {
        toast('Failed to load data', 'error');
    }
}

function goUp() {
    if (currentNodes.length > 0 && currentNodes[0].parent_id) {
        // Go to the parent of the current level's parent
        fetch(`/api/node/${currentNodes[0].parent_id}`)
            .then(r => r.json())
            .then(node => {
                if (node && node.parent_id) {
                    loadTree(node.parent_id);
                } else {
                    // Already at root level children
                    loadTree(1);
                }
            });
    }
}

function updateBackButton() {
    const btn = document.getElementById('btn-back');
    btn.style.display = (currentParent === 1) ? 'none' : 'block';
}

// ── Breadcrumbs ──────────────────────────────────────────────

async function renderBreadcrumbs(nodeId) {
    const container = document.getElementById('breadcrumbs');

    try {
        const res = await fetch(`/api/breadcrumbs/${nodeId}`);
        const chain = await res.json();

        let html = '';
        chain.forEach((node, i) => {
            if (i > 0) html += '<span class="crumb-sep">›</span>';
            if (i === chain.length - 1) {
                html += `<span class="crumb-current">${node.name}</span>`;
            } else {
                const targetId = (i === 0) ? 1 : node.id;
                html += `<span class="crumb" onclick="loadTree(${targetId})">${node.name}</span>`;
            }
        });

        container.innerHTML = html;
    } catch (e) {
        container.innerHTML = '<span class="crumb-current">National Budget</span>';
    }
}

// ══════════════════════════════════════════════════════════════
//  CHART RENDERING
// ══════════════════════════════════════════════════════════════

function renderChart(dataNodes) {
    const ctx = document.getElementById('budgetChart').getContext('2d');
    if (currentChart) currentChart.destroy();

    const labels = dataNodes.map(n => n.name);
    const data   = dataNodes.map(n => parseFloat(n.budget_allocation));
    const colors = A11Y_COLORS.slice(0, data.length);

    const dragConfig = (mode === 'edit' && isLoggedIn)
        ? {
            round: 2,
            showTooltip: true,
            onDragStart: function () { /* nothing */ },
            onDrag: function (e, datasetIndex, index, value) {
                adjustAllocations(index, value);
                renderEditableLegend(currentNodes);
                return value;
            },
            onDragEnd: function () {
                // Don't auto-save on drag; user clicks Save
            }
        }
        : false;

    currentChart = new Chart(ctx, {
        type: 'pie',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: colors,
                borderColor: '#ffffff',
                borderWidth: 2,
                hoverBorderWidth: 3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            animation: { duration: 400 },
            layout: { padding: 10 },
            onClick: handleChartClick,
            plugins: {
                legend: { display: false }, // We use our custom editable legend
                tooltip: {
                    callbacks: {
                        label: function (ctx) {
                            return `${ctx.label}: ${parseFloat(ctx.parsed).toFixed(2)}%`;
                        }
                    }
                },
                dragData: dragConfig
            }
        }
    });
}

async function handleChartClick(e, elements) {
    if (elements.length === 0) return;

    const index = elements[0].index;
    const clicked = currentNodes[index];

    // Check if this node has children before drilling down
    try {
        const res = await fetch(`/api/tree/${clicked.id}/has_children`);
        const data = await res.json();
        if (data.has_children) {
            loadTree(clicked.id);
        } else {
            toast(`"${clicked.name}" has no sub-categories`, 'error');
        }
    } catch (e) {
        // Try anyway
        loadTree(clicked.id);
    }
}

// ══════════════════════════════════════════════════════════════
//  EDITABLE LEGEND
// ══════════════════════════════════════════════════════════════

function renderEditableLegend(nodes) {
    const container = document.getElementById('editable-legend');
    const isEditable = (mode === 'edit' && isLoggedIn);
    let html = '';

    nodes.forEach((node, i) => {
        const color = A11Y_COLORS[i % A11Y_COLORS.length];
        const val   = parseFloat(node.budget_allocation).toFixed(2);

        html += `
        <div class="legend-row" data-index="${i}">
            <div class="legend-swatch" style="background:${color};"></div>
            <div class="legend-label" onclick="drillIntoNode(${i})" title="${node.description || node.name}">
                ${node.name}
                ${node.description ? `<span class="desc">${node.description}</span>` : ''}
            </div>
            <div class="legend-input-wrap">
                <input
                    type="number"
                    class="legend-input"
                    value="${val}"
                    min="0"
                    max="100"
                    step="0.5"
                    data-index="${i}"
                    ${isEditable ? '' : 'disabled'}
                    onchange="handleLegendInput(${i}, this.value)"
                    onfocus="this.select()"
                >
                <span class="legend-pct">%</span>
            </div>
        </div>`;
    });

    container.innerHTML = html;
    updateTotal();

    // Show/hide save button
    document.getElementById('btn-save').style.display = isEditable ? 'block' : 'none';
}

function handleLegendInput(index, rawValue) {
    const newValue = parseFloat(rawValue);
    if (isNaN(newValue)) return;

    adjustAllocations(index, newValue);
    renderEditableLegend(currentNodes);
    syncChartData();
}

async function drillIntoNode(index) {
    const node = currentNodes[index];
    try {
        const res = await fetch(`/api/tree/${node.id}/has_children`);
        const data = await res.json();
        if (data.has_children) {
            loadTree(node.id);
        } else {
            toast(`"${node.name}" has no sub-categories`, 'error');
        }
    } catch (e) {
        loadTree(node.id);
    }
}

function updateTotal() {
    let total = 0;
    currentNodes.forEach(n => { total += parseFloat(n.budget_allocation); });

    const el = document.getElementById('legend-total');
    el.textContent = total.toFixed(2) + '%';
    el.classList.toggle('warn', Math.abs(total - 100) > 0.1);
}

// ══════════════════════════════════════════════════════════════
//  PROPORTIONAL ADJUSTMENT ALGORITHM
// ══════════════════════════════════════════════════════════════

function adjustAllocations(changedIndex, newValue) {
    // Clamp to [0, 100]
    newValue = Math.max(0, Math.min(100, newValue));

    const oldVal    = parseFloat(currentNodes[changedIndex].budget_allocation);
    const diff      = newValue - oldVal;
    const sumOthers = 100 - oldVal;

    if (Math.abs(diff) < 0.001) return; // No meaningful change

    if (sumOthers <= 0) {
        // Edge case: this slice was already 100%, distribute equally
        const equalShare = (100 - newValue) / (currentNodes.length - 1);
        for (let i = 0; i < currentNodes.length; i++) {
            if (i !== changedIndex) {
                currentNodes[i].budget_allocation = Math.max(0, equalShare).toFixed(2);
            }
        }
    } else {
        for (let i = 0; i < currentNodes.length; i++) {
            if (i !== changedIndex) {
                const currentVal = parseFloat(currentNodes[i].budget_allocation);
                const proportion = currentVal / sumOthers;
                const adjusted   = currentVal - (diff * proportion);
                currentNodes[i].budget_allocation = Math.max(0, adjusted).toFixed(2);
            }
        }
    }

    currentNodes[changedIndex].budget_allocation = newValue.toFixed(2);

    // Fix floating point drift: ensure sum is exactly 100
    normalizeTo100(changedIndex);
}

function normalizeTo100(fixedIndex) {
    let sum = 0;
    currentNodes.forEach(n => { sum += parseFloat(n.budget_allocation); });

    const drift = sum - 100;
    if (Math.abs(drift) < 0.005) return;

    // Distribute the drift across non-fixed, non-zero slices
    const adjustable = currentNodes
        .map((n, i) => ({ i, val: parseFloat(n.budget_allocation) }))
        .filter(x => x.i !== fixedIndex && x.val > 0);

    if (adjustable.length === 0) return;

    const adjustSum = adjustable.reduce((s, x) => s + x.val, 0);
    for (const item of adjustable) {
        const share = item.val / adjustSum;
        const fix   = drift * share;
        const newVal = Math.max(0, item.val - fix);
        currentNodes[item.i].budget_allocation = newVal.toFixed(2);
    }
}

function syncChartData() {
    if (!currentChart) return;
    currentChart.data.datasets[0].data = currentNodes.map(n => parseFloat(n.budget_allocation));
    currentChart.update('none'); // No animation for immediate feedback
}

// ══════════════════════════════════════════════════════════════
//  MODE SWITCHING
// ══════════════════════════════════════════════════════════════

function switchMode(newMode) {
    if (newMode === 'edit' && !isLoggedIn) {
        openLoginModal();
        return;
    }

    mode = newMode;
    document.getElementById('btn-view').classList.toggle('active', mode === 'view');
    document.getElementById('btn-edit').classList.toggle('active', mode === 'edit');

    // Reload current level with new mode
    loadTree(currentParent);
}

// ══════════════════════════════════════════════════════════════
//  SAVE ALLOCATIONS
// ══════════════════════════════════════════════════════════════

async function saveAllocations() {
    if (mode !== 'edit' || !isLoggedIn) return;

    try {
        const res = await fetch('/api/allocate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(currentNodes)
        });

        if (res.ok) {
            toast('Allocation saved!', 'success');
        } else {
            const err = await res.json();
            toast(err.error || 'Save failed', 'error');
        }
    } catch (e) {
        toast('Connection error', 'error');
    }
}

// ══════════════════════════════════════════════════════════════
//  STATS
// ══════════════════════════════════════════════════════════════

async function loadStats() {
    try {
        const res  = await fetch('/api/stats');
        const data = await res.json();
        const bar  = document.getElementById('stats-bar');

        if (data.total_participants > 0) {
            bar.textContent = `${data.total_participants} participant(s) · ${data.total_votes} allocation(s)`;
        } else {
            bar.textContent = 'No allocations yet — be the first!';
        }
    } catch (e) {
        // Silently ignore
    }
}

// ══════════════════════════════════════════════════════════════
//  TOAST NOTIFICATIONS
// ══════════════════════════════════════════════════════════════

function toast(message, type = 'success') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => {
        el.style.opacity = '0';
        el.style.transition = 'opacity 0.3s';
        setTimeout(() => el.remove(), 300);
    }, 2500);
}
