// Crypto之路 - 主应用逻辑

// ==================== 常量配置 ====================
const CONFIG = {
    STORAGE_KEY: 'financeTrackerData',
    RATE_KEY: 'financeTrackerRate',
    TOKEN_KEY: 'financeTrackerToken',
    GIST_KEY: 'financeTrackerGistId',
    RATE_CACHE_KEY: 'financeTrackerRateCache',
    DEFAULT_RATE: 7.25,
    RATE_CACHE_DURATION: 30 * 60 * 1000, // 30分钟缓存
    DEBOUNCE_DELAY: 300,
    TOAST_DURATION: 3000,
    MAX_DAYS_DISPLAY: 30, // 每次显示的天数
    API_TIMEOUT: 10000,
    EXCHANGE_API: 'https://api.exchangerate-api.com/v4/latest/USD',
    SYNC_STATE_KEY: 'financeTrackerNeedSync',
    BACKGROUND_SYNC_INTERVAL: 60000 // 1分钟检查一次
};

// ==================== 简单加密工具 ====================
const CryptoUtil = {
    // 简单的混淆加密（非强加密，但比明文好）
    encode(str) {
        if (!str) return '';
        try {
            return btoa(str.split('').reverse().join(''));
        } catch (e) {
            return str;
        }
    },
    decode(str) {
        if (!str) return '';
        try {
            return atob(str).split('').reverse().join('');
        } catch (e) {
            return str;
        }
    }
};

// ==================== 输入验证工具 ====================
const Validator = {
    isValidNumber(value, min = -Infinity, max = Infinity) {
        const num = parseFloat(value);
        return !isNaN(num) && isFinite(num) && num >= min && num <= max;
    },
    isValidDate(dateStr) {
        const date = new Date(dateStr);
        return date instanceof Date && !isNaN(date);
    },
    sanitizeString(str, maxLength = 200) {
        if (typeof str !== 'string') return '';
        return str.trim().slice(0, maxLength);
    },
    isValidGistId(id) {
        return /^[a-f0-9]{32}$/i.test(id);
    },
    isValidToken(token) {
        return /^(ghp_|gho_|github_pat_)[a-zA-Z0-9_]+$/.test(token);
    }
};

// ==================== 防抖工具 ====================
const debounce = (fn, delay = CONFIG.DEBOUNCE_DELAY) => {
    let timer = null;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
    };
};

// ==================== 日期工具 ====================
const DateUtil = {
    // 获取本地日期字符串 (YYYY-MM-DD)，避免时区问题
    getLocalDateString(date = new Date()) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    },

    // 获取今天的日期字符串
    getToday() {
        return this.getLocalDateString(new Date());
    },

    // 获取本周开始日期（周日为一周开始）
    getWeekStart(date = new Date()) {
        const d = new Date(date);
        d.setDate(d.getDate() - d.getDay());
        d.setHours(0, 0, 0, 0);
        return d;
    },

    // 获取本月开始日期
    getMonthStart(date = new Date()) {
        return new Date(date.getFullYear(), date.getMonth(), 1);
    },

    // 解析日期字符串为本地日期对象
    parseLocalDate(dateStr) {
        const [year, month, day] = dateStr.split('-').map(Number);
        return new Date(year, month - 1, day);
    },

    // 计算两个日期之间的天数差
    daysBetween(date1, date2) {
        const d1 = new Date(date1);
        const d2 = new Date(date2);
        d1.setHours(0, 0, 0, 0);
        d2.setHours(0, 0, 0, 0);
        return Math.floor((d2 - d1) / (1000 * 60 * 60 * 24));
    }
};

// ==================== 全局状态 ====================
let entries = [];
let exchangeRate = 0;
let chart = null;
let currentPeriod = 'week';
let isOnline = false;
let githubToken = '';
let gistId = '';
let isLoading = false;
let historyDisplayDays = CONFIG.MAX_DAYS_DISPLAY; // 当前显示的天数

// DOM 元素
const elements = {
    entryForm: document.getElementById('entryForm'),
    entryDate: document.getElementById('entryDate'),
    profitAmount: document.getElementById('profitAmount'),
    lossAmount: document.getElementById('lossAmount'),
    entryNote: document.getElementById('entryNote'),
    exchangeRateInput: document.getElementById('exchangeRate'),
    updateRateBtn: document.getElementById('updateRateBtn'),
    todayPnL: document.getElementById('todayPnL'),
    todayPnLCNY: document.getElementById('todayPnLCNY'),
    totalPnL: document.getElementById('totalPnL'),
    totalPnLCNY: document.getElementById('totalPnLCNY'),
    weeklyAvg: document.getElementById('weeklyAvg'),
    weeklyAvgCNY: document.getElementById('weeklyAvgCNY'),
    monthlyAvg: document.getElementById('monthlyAvg'),
    monthlyAvgCNY: document.getElementById('monthlyAvgCNY'),
    historyList: document.getElementById('historyList'),
    historyMonth: document.getElementById('historyMonth'),
    clearFilterBtn: document.getElementById('clearFilterBtn'),
    exportBtn: document.getElementById('exportBtn'),
    importBtn: document.getElementById('importBtn'),
    importFile: document.getElementById('importFile'),
    clearBtn: document.getElementById('clearBtn'),
    chartCanvas: document.getElementById('pnlChart'),
    syncBtn: document.getElementById('syncBtn')
};

// 初始化应用
async function init() {
    loadCredentials();
    setDefaultDate();
    bindEvents();

    // 先获取最新汇率
    await loadExchangeRate();

    // 加载账户数据（确保在 loadData 之前加载，防止自动同步时上传空数据）
    loadAccountsData();

    // 如果未配置云端，先弹出配置对话框，但继续加载本地数据
    if (!githubToken || !gistId) {
        showCloudConfigDialog(true); // true 表示首次配置
    }

    // 始终尝试加载数据（loadData 内部会处理云端/本地的优先级）
    isOnline = !!(githubToken && gistId);
    updateSyncStatus();

    await loadData();
    updateUI();
    initChart();

    // 初始化账户模块
    initAccountsModule();

    // 启动后台同步机制
    startBackgroundSync();
}

// 加载保存的凭证（解密）
function loadCredentials() {
    const encodedToken = localStorage.getItem(CONFIG.TOKEN_KEY) || '';
    githubToken = CryptoUtil.decode(encodedToken);
    gistId = localStorage.getItem(CONFIG.GIST_KEY) || '';
}

// 保存凭证到本地存储（加密Token）
function saveCredentials() {
    if (githubToken) {
        localStorage.setItem(CONFIG.TOKEN_KEY, CryptoUtil.encode(githubToken));
    }
    if (gistId) {
        localStorage.setItem(CONFIG.GIST_KEY, gistId);
    }
}

// 带超时的 fetch 请求
async function fetchWithTimeout(url, options = {}, timeout = CONFIG.API_TIMEOUT) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        return response;
    } catch (e) {
        clearTimeout(timeoutId);
        if (e.name === 'AbortError') {
            throw new Error('请求超时');
        }
        throw e;
    }
}

// 加载数据 - 智能合并本地和云端数据
async function loadData() {
    if (isLoading) return;
    isLoading = true;

    try {
        // 1. 先加载本地数据
        const localStored = localStorage.getItem(CONFIG.STORAGE_KEY);
        let localEntries = [];
        if (localStored) {
            try {
                const parsed = JSON.parse(localStored);
                if (Array.isArray(parsed)) {
                    localEntries = parsed;
                }
            } catch (e) {
                console.error('本地数据解析失败:', e);
            }
        }

        // 默认使用本地数据
        entries = [...localEntries];

        // 2. 尝试加载云端数据
        if (gistId && githubToken) {
            try {
                const response = await fetchWithTimeout(`https://api.github.com/gists/${gistId}`, {
                    headers: {
                        'Authorization': `token ${githubToken}`,
                        'Accept': 'application/vnd.github.v3+json'
                    }
                });

                if (response.ok) {
                    const gistData = await response.json();
                    const fileContent = gistData.files['finance-data.json']?.content;

                    if (fileContent) {
                        const cloudData = JSON.parse(fileContent);
                        let cloudEntries = [];

                        if (cloudData.entries && Array.isArray(cloudData.entries)) {
                            cloudEntries = cloudData.entries
                                .filter(e => e && typeof e === 'object' && e.id && e.date)
                                .map(e => ({
                                    ...e,
                                    profit: parseFloat(e.profit) || 0,
                                    loss: parseFloat(e.loss) || 0,
                                    pnl: parseFloat(e.pnl) || 0,
                                    note: Validator.sanitizeString(e.note || '')
                                }));
                        }

                        // 3. 执行合并 (以 ID 为唯一标识)
                        const mergedEntries = mergeEntries(localEntries, cloudEntries);

                        // 排序
                        mergedEntries.sort((a, b) => {
                            if (a.date !== b.date) {
                                return new Date(b.date) - new Date(a.date);
                            }
                            return new Date(b.createdAt) - new Date(a.createdAt);
                        });

                        // 更新内存状态
                        entries = mergedEntries;

                        // 更新本地存储
                        saveData();

                        // 检查是否需要反向同步（如果合并结果比云端多/新）
                        // 简单判断：如果数量不同，或者本地有云端没有的数据，则同步
                        if (mergedEntries.length > cloudEntries.length) {
                            // 使用防抖或直接同步，这里直接调用保存逻辑（复用 handleFormSubmit 中的同步部分逻辑，最好提取出来）
                            // 由于 loadData 是初始化，我们可以异步触发一次同步
                            autoSyncToCloud().then(success => {
                                if (success) showToast('已将本地增量数据同步至云端');
                            });
                        }

                        // 处理账户数据 - 使用智能合并（与盈亏数据一致）
                        if (cloudData.accountEntries && Array.isArray(cloudData.accountEntries)) {
                            // 获取本地账户数据
                            const localAccountEntries = [...accountEntries];
                            
                            // 验证并清洗云端账户数据
                            const cloudAccountEntries = cloudData.accountEntries
                                .filter(e => e && typeof e === 'object' && e.date)
                                .map(e => ({
                                    id: e.id || Date.now(),
                                    date: e.date,
                                    binance: parseFloat(e.binance) || 0,
                                    okx: parseFloat(e.okx) || 0,
                                    wallet: parseFloat(e.wallet) || 0,
                                    total: parseFloat(e.total) || 0,
                                    createdAt: e.createdAt || new Date().toISOString()
                                }));
                            
                            // 智能合并本地和云端账户数据
                            const mergedAccountEntries = mergeAccountEntries(localAccountEntries, cloudAccountEntries);
                            
                            // 按日期排序（最新在前）
                            mergedAccountEntries.sort((a, b) => new Date(b.date) - new Date(a.date));
                            
                            accountEntries = mergedAccountEntries;
                            saveAccountsData();
                            
                            // 如果合并后数据比云端多，触发反向同步
                            if (mergedAccountEntries.length > cloudAccountEntries.length) {
                                autoSyncToCloud().then(success => {
                                    if (success) console.log('账户数据增量已同步至云端');
                                });
                            }
                        }

                        isOnline = true;
                        showToast('数据已同步 (本地+云端)');
                        return;
                    }
                } else {
                    console.error('云端加载失败:', response.status);
                    showToast('云端连接失败，使用本地数据');
                }
            } catch (e) {
                console.error('云端数据加载失败:', e);
                showToast('无法连接云端，使用离线模式');
            }
        }
    } finally {
        isLoading = false;
    }
}

// 合并两个记录数组（基于 ID 去重）
function mergeEntries(localList, cloudList) {
    const map = new Map();

    // 1. 放入本地数据
    localList.forEach(e => map.set(e.id, e));

    // 2. 放入云端数据（如果 ID 相同，以云端为准？或者以本地为准？
    // 通常云端视为"已同步的真理"，但如果本地有修改意图...
    // 这里采用：只要 ID 存在，就保留。如果冲突，这里优先保留云端数据（假设云端是多端同步的结果）
    // 或者，我们可以保留最后更新的那个。目前 app 没有 updatedAt，只有 createdAt。
    // 既然 ID 是时间戳，且不可变，那么 ID 相同内容应该相同。
    // 唯一的变数是如果在不同设备修改了同一条记录的 note。
    // 简单起见，覆盖策略：云端覆盖本地。但本地独有的保留。
    cloudList.forEach(e => map.set(e.id, e));

    return Array.from(map.values());
}

// 合并账户数据（与 mergeEntries 类似，但账户数据以日期为唯一标识）
function mergeAccountEntries(localList, cloudList) {
    const map = new Map();

    // 1. 放入本地数据（以日期为 key）
    localList.forEach(e => {
        if (e && e.date) {
            map.set(e.date, e);
        }
    });

    // 2. 放入云端数据
    // 如果同一天有冲突，比较 createdAt 时间戳，保留较新的
    cloudList.forEach(e => {
        if (e && e.date) {
            const existing = map.get(e.date);
            if (!existing) {
                map.set(e.date, e);
            } else {
                // 比较时间戳，保留较新的记录
                const existingTime = new Date(existing.createdAt || 0).getTime();
                const cloudTime = new Date(e.createdAt || 0).getTime();
                if (cloudTime >= existingTime) {
                    map.set(e.date, e);
                }
            }
        }
    });

    return Array.from(map.values());
}

// 保存数据到本地存储
function saveData() {
    try {
        localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(entries));
        // 标记为需要同步（脏数据）
        localStorage.setItem(CONFIG.SYNC_STATE_KEY, 'true');
    } catch (e) {
        console.error('保存数据失败:', e);
        showToast('存储空间不足，请清理数据');
    }
}

// 加载汇率（带缓存）
async function loadExchangeRate() {
    // 检查缓存
    const cached = localStorage.getItem(CONFIG.RATE_CACHE_KEY);
    if (cached) {
        try {
            const { rate, timestamp } = JSON.parse(cached);
            if (Date.now() - timestamp < CONFIG.RATE_CACHE_DURATION) {
                exchangeRate = rate;
                elements.exchangeRateInput.value = exchangeRate.toFixed(2);
                // 后台静默更新
                fetchLatestExchangeRate(true);
                return;
            }
        } catch (e) {
            // 缓存无效，继续获取
        }
    }

    // 从 API 获取
    const success = await fetchLatestExchangeRate(true);

    if (!success) {
        const stored = localStorage.getItem(CONFIG.RATE_KEY);
        if (stored) {
            exchangeRate = parseFloat(stored);
            elements.exchangeRateInput.value = exchangeRate.toFixed(2);
        } else {
            exchangeRate = CONFIG.DEFAULT_RATE;
            elements.exchangeRateInput.value = exchangeRate.toFixed(2);
        }
    }
}

// 从API获取最新USD/CNY汇率
async function fetchLatestExchangeRate(silent = false) {
    try {
        const response = await fetchWithTimeout(CONFIG.EXCHANGE_API);
        if (response.ok) {
            const data = await response.json();
            if (data.rates && data.rates.CNY) {
                const newRate = data.rates.CNY;
                exchangeRate = newRate;
                elements.exchangeRateInput.value = exchangeRate.toFixed(2);
                saveExchangeRate();

                // 保存缓存
                localStorage.setItem(CONFIG.RATE_CACHE_KEY, JSON.stringify({
                    rate: newRate,
                    timestamp: Date.now()
                }));

                if (entries.length > 0) {
                    updateUI();
                }

                if (!silent) {
                    showToast(`汇率已更新: 1 USD = ${exchangeRate.toFixed(2)} CNY`);
                }
                return true;
            }
        }
    } catch (e) {
        console.log('获取汇率失败:', e.message);
        if (!silent) {
            showToast('获取汇率失败，请稍后重试');
        }
    }
    return false;
}

// 保存汇率
function saveExchangeRate() {
    localStorage.setItem(CONFIG.RATE_KEY, exchangeRate.toString());
}

// 设置默认日期为今天
function setDefaultDate() {
    const today = DateUtil.getToday();
    elements.entryDate.value = today;
}

// 绑定事件
function bindEvents() {
    // 表单提交
    elements.entryForm.addEventListener('submit', handleFormSubmit);

    // 添加记录按钮 - 打开弹窗
    const addEntryBtn = document.getElementById('addEntryBtn');
    const entryModal = document.getElementById('entryModal');
    const closeModalBtn = document.getElementById('closeModalBtn');

    if (addEntryBtn && entryModal) {
        addEntryBtn.addEventListener('click', () => {
            setDefaultDate();
            entryModal.style.display = 'flex';
        });
    }

    // 关闭弹窗
    if (closeModalBtn && entryModal) {
        closeModalBtn.addEventListener('click', () => {
            entryModal.style.display = 'none';
        });

        // 点击遮罩关闭
        entryModal.addEventListener('click', (e) => {
            if (e.target === entryModal) {
                entryModal.style.display = 'none';
            }
        });
    }

    // 汇率更新
    elements.updateRateBtn.addEventListener('click', handleRateUpdate);

    // 获取最新汇率按钮
    const fetchRateBtn = document.getElementById('fetchRateBtn');
    if (fetchRateBtn) {
        fetchRateBtn.addEventListener('click', async () => {
            showToast('正在获取最新汇率...');
            await fetchLatestExchangeRate(false); // 非静默模式，显示结果
        });
    }

    // 历史筛选
    elements.historyMonth.addEventListener('change', () => {
        historyDisplayDays = CONFIG.MAX_DAYS_DISPLAY; // 重置显示天数
        renderHistory();
    });
    elements.clearFilterBtn.addEventListener('click', () => {
        elements.historyMonth.value = '';
        historyDisplayDays = CONFIG.MAX_DAYS_DISPLAY; // 重置显示天数
        renderHistory();
    });

    // 图表切换
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            currentPeriod = e.target.dataset.period;
            updateChart();
        });
    });

    // 数据管理
    elements.exportBtn.addEventListener('click', exportData);
    elements.importBtn.addEventListener('click', () => elements.importFile.click());
    elements.importFile.addEventListener('change', importData);
    elements.clearBtn.addEventListener('click', clearAllData);

    // 云端同步
    if (elements.syncBtn) {
        elements.syncBtn.addEventListener('click', syncToGitHub);
    }

    // 底部导航切换
    bindNavEvents();

    // 更新同步状态显示
    updateSyncStatus();
}

// 绑定顶部导航事件
function bindNavEvents() {
    const navItems = document.querySelectorAll('.top-nav .nav-item');
    console.log('Nav items found:', navItems.length);
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const targetPage = item.dataset.page;
            console.log('Switching to:', targetPage);
            switchPage(targetPage);
        });
    });
}

// 切换页面
function switchPage(pageId) {
    console.log('switchPage called with:', pageId);
    // 更新页面显示
    const pages = document.querySelectorAll('.page');
    console.log('Found pages:', pages.length);
    pages.forEach(page => {
        page.classList.remove('active');
    });
    const targetPage = document.getElementById(pageId);
    console.log('Target page:', targetPage);
    if (targetPage) {
        targetPage.classList.add('active');
        console.log('Added active class to:', pageId);
    }

    // 更新导航状态
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
        if (item.dataset.page === pageId) {
            item.classList.add('active');
        }
    });

    // 切换到账户页面时刷新图表
    if (pageId === 'accountsPage' && typeof accountsChart !== 'undefined' && accountsChart) {
        updateAccountsChart();
    }

    // 切换到盈亏页面时刷新图表
    if (pageId === 'pnlPage' && chart) {
        updateChart();
    }
}
// 暴露到全局，供 HTML onclick 调用
window.switchPage = switchPage;

// 处理表单提交（乐观更新：本地立即生效，云端异步同步）
function handleFormSubmit(e) {
    e.preventDefault();

    const date = elements.entryDate.value;
    const profit = parseFloat(elements.profitAmount.value) || 0;
    const loss = parseFloat(elements.lossAmount.value) || 0;
    const note = Validator.sanitizeString(elements.entryNote.value);

    // 验证日期
    if (!date || !Validator.isValidDate(date)) {
        showToast('请选择有效日期');
        return;
    }

    // 验证金额
    if (!Validator.isValidNumber(profit, 0, 999999999) || !Validator.isValidNumber(loss, 0, 999999999)) {
        showToast('请输入有效金额');
        return;
    }

    if (profit === 0 && loss === 0) {
        showToast('请输入盈利或亏损金额');
        return;
    }

    const entry = {
        id: Date.now(),
        date,
        profit,
        loss,
        pnl: profit - loss,
        note,
        createdAt: new Date().toISOString()
    };

    entries.push(entry);

    entries.sort((a, b) => {
        if (a.date !== b.date) {
            return new Date(b.date) - new Date(a.date);
        }
        return new Date(b.createdAt) - new Date(a.createdAt);
    });

    // 1. 本地立即保存
    saveData();
    
    // 2. 立即更新 UI
    updateUI();

    // 3. 重置表单
    elements.profitAmount.value = '';
    elements.lossAmount.value = '';
    elements.entryNote.value = '';
    setDefaultDate();

    // 4. 立即关闭弹窗
    const entryModal = document.getElementById('entryModal');
    if (entryModal) {
        entryModal.style.display = 'none';
    }

    // 5. 显示本地成功提示
    showToast('记录已添加');

    // 6. 异步后台同步到云端（不阻塞用户操作）
    autoSyncToCloud().then(syncSuccess => {
        if (syncSuccess) {
            showToast('已同步到云端');
        }
        // 同步失败时不打扰用户，后台会自动重试
    });
}

// 处理汇率更新
function handleRateUpdate() {
    const newRate = parseFloat(elements.exchangeRateInput.value);
    if (Validator.isValidNumber(newRate, 0.01, 100)) {
        exchangeRate = newRate;
        saveExchangeRate();
        updateUI();
        showToast('汇率已更新');
    } else {
        showToast('请输入有效的汇率 (0.01-100)');
    }
}

// 更新所有 UI
function updateUI() {
    updateStats();
    renderHistory();
    updateChart();
}

// 更新统计数据
function updateStats() {
    const today = DateUtil.getToday();
    const now = new Date();

    // 今日盈亏（汇总当天所有记录）
    const todayEntries = entries.filter(e => e.date === today);
    const todayPnL = todayEntries.reduce((sum, e) => sum + e.pnl, 0);
    updateStatDisplay('todayPnL', 'todayPnLCNY', todayPnL);

    // 累计盈亏
    const totalPnL = entries.reduce((sum, e) => sum + e.pnl, 0);
    updateStatDisplay('totalPnL', 'totalPnLCNY', totalPnL);

    // 本月累计（自然月1号到今天的总收益）
    const monthStart = DateUtil.getMonthStart(now);
    const monthStartStr = DateUtil.getLocalDateString(monthStart);
    const monthEntries = entries.filter(e => e.date >= monthStartStr && e.date <= today);
    const monthTotal = monthEntries.reduce((sum, e) => sum + e.pnl, 0);
    updateStatDisplay('monthlyTotal', 'monthlyTotalCNY', monthTotal);

    // 本周日均（本周累计 ÷ 本周已过天数，周日为第1天）
    const weekStart = DateUtil.getWeekStart(now);
    const weekStartStr = DateUtil.getLocalDateString(weekStart);

    const weekEntries = entries.filter(e => e.date >= weekStartStr && e.date <= today);
    const weekTotal = weekEntries.reduce((sum, e) => sum + e.pnl, 0);
    const weekDaysPassed = now.getDay() + 1; // 周日=0，所以+1表示本周已过天数
    const weeklyAvg = weekTotal / weekDaysPassed;
    updateStatDisplay('weeklyAvg', 'weeklyAvgCNY', weeklyAvg);

    // 本月日均（本月累计 ÷ 自然月1号到今天的天数）
    const todayDate = now.getDate(); // 今天是几号，即本月已过天数
    const monthlyAvg = monthTotal / todayDate;
    updateStatDisplay('monthlyAvg', 'monthlyAvgCNY', monthlyAvg);

    // 历史累计日均（累计盈亏 ÷ 从第一条记录到今天的天数）
    if (entries.length > 0) {
        // 找到最早的记录日期
        const allDates = entries.map(e => e.date).sort();
        const firstDateStr = allDates[0];
        const firstDate = DateUtil.parseLocalDate(firstDateStr);
        const todayDate = DateUtil.parseLocalDate(today);

        // 计算从第一条记录到今天的天数（包含首尾两天）
        const daysDiff = DateUtil.daysBetween(firstDate, todayDate) + 1;
        const historyAvg = totalPnL / daysDiff;
        updateStatDisplay('historyAvg', 'historyAvgCNY', historyAvg);
    } else {
        updateStatDisplay('historyAvg', 'historyAvgCNY', 0);
    }
}

// 更新统计显示
function updateStatDisplay(usdId, cnyId, amount) {
    const usdEl = document.getElementById(usdId);
    const cnyEl = document.getElementById(cnyId);

    if (!usdEl || !cnyEl) return;

    usdEl.textContent = formatUSD(amount);
    cnyEl.textContent = formatCNY(amount * exchangeRate);

    // 更新颜色：正数为绿，负数为红，0为默认
    // 移除之前的类名限制，强制应用颜色
    usdEl.style.color = ''; // 重置
    cnyEl.style.color = '';

    if (amount > 0) {
        usdEl.style.color = 'var(--success-color)';
    } else if (amount < 0) {
        usdEl.style.color = 'var(--danger-color)';
    } else {
        usdEl.style.color = 'var(--text-primary)';
    }
}

// 按日期汇总数据
function getDailyTotals() {
    const dailyMap = new Map();

    entries.forEach(entry => {
        const existing = dailyMap.get(entry.date) || { pnl: 0, count: 0 };
        existing.pnl += entry.pnl;
        existing.count += 1;
        dailyMap.set(entry.date, existing);
    });

    return dailyMap;
}

// 渲染历史记录（按日期分组显示，支持折叠和按天数分页加载）
function renderHistory() {
    const filterMonth = elements.historyMonth.value;

    let filteredEntries = entries;
    if (filterMonth) {
        filteredEntries = entries.filter(e => e.date.startsWith(filterMonth));
    }

    if (filteredEntries.length === 0) {
        elements.historyList.innerHTML = '<p class="empty-state">暂无记录</p>';
        return;
    }

    // 先按日期分组所有记录
    const allGroupedByDate = new Map();
    filteredEntries.forEach(entry => {
        if (!allGroupedByDate.has(entry.date)) {
            allGroupedByDate.set(entry.date, []);
        }
        allGroupedByDate.get(entry.date).push(entry);
    });

    // 获取所有日期并排序（最新在前）
    const allDates = Array.from(allGroupedByDate.keys()).sort((a, b) => new Date(b) - new Date(a));
    const totalDays = allDates.length;

    // 根据当前显示天数限制
    const displayDates = allDates.slice(0, historyDisplayDays);

    // 使用 DocumentFragment 优化 DOM 操作
    const fragment = document.createDocumentFragment();
    let isFirst = true;

    displayDates.forEach(date => {
        const dayEntries = allGroupedByDate.get(date);
        const dayTotal = dayEntries.reduce((sum, e) => sum + e.pnl, 0);
        const dateObj = DateUtil.parseLocalDate(date);
        const weekday = dateObj.toLocaleDateString('zh-CN', { weekday: 'short' });
        const dateDisplay = formatDateCompact(date);

        const dayDiv = document.createElement('div');
        // 只展开第一天（最新），其他默认折叠
        dayDiv.className = isFirst ? 'history-day' : 'history-day collapsed';
        dayDiv.innerHTML = `
            <div class="history-day-header" role="button" tabindex="0" aria-expanded="${isFirst}">
                <span class="history-day-date">${dateDisplay}<span class="history-day-weekday">${weekday}</span></span>
                <span class="history-day-total ${dayTotal >= 0 ? 'positive' : 'negative'}">
                    ${formatUSD(dayTotal)} / ${formatCNY(dayTotal * exchangeRate)}
                </span>
            </div>
            <div class="history-day-items">
                ${dayEntries.map(entry => `
                    <div class="history-item" data-id="${entry.id}">
                        <div class="history-item-info">
                            <div class="history-time">${formatTime(entry.createdAt)}</div>
                            ${entry.note ? `<div class="history-note" title="${escapeHtml(entry.note)}">${escapeHtml(entry.note)}</div>` : ''}
                        </div>
                        <div class="history-amounts">
                            <div class="history-pnl ${entry.pnl >= 0 ? 'positive' : 'negative'}">
                                ${formatUSD(entry.pnl)}
                            </div>
                            <div class="history-pnl-cny">${formatCNY(entry.pnl * exchangeRate)}</div>
                        </div>
                        <div class="history-actions">
                            <button class="delete-btn" onclick="deleteEntry(${entry.id})" title="删除" aria-label="删除记录">🗑️</button>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;

        // 添加折叠切换事件
        const header = dayDiv.querySelector('.history-day-header');
        header.addEventListener('click', () => {
            dayDiv.classList.toggle('collapsed');
            header.setAttribute('aria-expanded', !dayDiv.classList.contains('collapsed'));
        });
        header.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                dayDiv.classList.toggle('collapsed');
                header.setAttribute('aria-expanded', !dayDiv.classList.contains('collapsed'));
            }
        });

        fragment.appendChild(dayDiv);
        isFirst = false;
    });

    elements.historyList.innerHTML = '';
    elements.historyList.appendChild(fragment);

    // 显示"查看更多"按钮或统计信息
    const remainingDays = totalDays - historyDisplayDays;
    if (remainingDays > 0) {
        const loadMoreDiv = document.createElement('div');
        loadMoreDiv.className = 'load-more-container';
        loadMoreDiv.innerHTML = `
            <button class="btn btn-load-more" id="loadMoreBtn">
                查看更多 (还有 ${remainingDays} 天)
            </button>
            <p class="history-count-hint">已显示 ${displayDates.length} / ${totalDays} 天</p>
        `;
        elements.historyList.appendChild(loadMoreDiv);

        // 绑定"查看更多"按钮事件
        document.getElementById('loadMoreBtn').addEventListener('click', () => {
            historyDisplayDays += CONFIG.MAX_DAYS_DISPLAY;
            renderHistory();
        });
    } else if (totalDays > CONFIG.MAX_DAYS_DISPLAY) {
        // 已全部显示，但总天数超过默认值时显示统计
        const countHint = document.createElement('p');
        countHint.className = 'history-count-hint';
        countHint.textContent = `共 ${totalDays} 天记录`;
        elements.historyList.appendChild(countHint);
    }
}

// 格式化日期（紧凑版）
function formatDateCompact(dateStr) {
    const date = DateUtil.parseLocalDate(dateStr);
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

// 删除记录
async function deleteEntry(id) {
    if (confirm('确定要删除这条记录吗？')) {
        entries = entries.filter(e => e.id !== id);
        saveData();
        updateUI();

        // 等待同步到云端完成
        showToast('正在同步到云端...');
        const success = await autoSyncToCloud();
        if (success) {
            showToast('记录已删除并同步');
        } else {
            showToast('删除成功，但云端同步失败');
        }
    }
}

// 初始化图表
function initChart() {
    const ctx = elements.chartCanvas.getContext('2d');

    chart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: [],
            datasets: [{
                label: '每日盈亏 (USD)',
                data: [],
                backgroundColor: [],
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            const value = context.raw;
                            return [
                                `USD: ${formatUSD(value)}`,
                                `CNY: ${formatCNY(value * exchangeRate)}`
                            ];
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: {
                        color: 'rgba(0, 0, 0, 0.05)'
                    }
                },
                x: {
                    grid: {
                        display: false
                    }
                }
            }
        }
    });

    updateChart();
}

// 更新图表
function updateChart() {
    if (!chart) return;

    const now = new Date();
    let chartData = [];
    let labels = [];

    // 获取每日汇总
    const dailyTotals = getDailyTotals();

    switch (currentPeriod) {
        case 'week':
            // 最近7天
            for (let i = 6; i >= 0; i--) {
                const date = new Date(now);
                date.setDate(now.getDate() - i);
                const dateStr = DateUtil.getLocalDateString(date);
                const dayData = dailyTotals.get(dateStr);
                chartData.push(dayData ? dayData.pnl : 0);
                labels.push(formatShortDate(dateStr));
            }
            break;

        case 'month':
            // 最近30天
            for (let i = 29; i >= 0; i--) {
                const date = new Date(now);
                date.setDate(now.getDate() - i);
                const dateStr = DateUtil.getLocalDateString(date);
                const dayData = dailyTotals.get(dateStr);
                chartData.push(dayData ? dayData.pnl : 0);
                labels.push(date.getDate().toString());
            }
            break;

        case 'all':
            // 所有数据（按日期汇总，最多60天）
            const sortedDates = Array.from(dailyTotals.keys()).sort();
            const recentDates = sortedDates.slice(-60);
            chartData = recentDates.map(date => dailyTotals.get(date).pnl);
            labels = recentDates.map(date => formatShortDate(date));
            break;
    }

    // 更新图表数据
    chart.data.labels = labels;
    chart.data.datasets[0].data = chartData;
    chart.data.datasets[0].backgroundColor = chartData.map(v =>
        v >= 0 ? 'rgba(16, 185, 129, 0.7)' : 'rgba(239, 68, 68, 0.7)'
    );

    chart.update();
}

// 导出数据
function exportData() {
    const data = {
        version: '1.0',
        exportDate: new Date().toISOString(),
        exchangeRate,
        entries
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `finance-tracker-${DateUtil.getToday()}.json`;
    a.click();
    URL.revokeObjectURL(url);

    showToast('数据已导出');
}

// 导入数据（带验证）
function importData(e) {
    const file = e.target.files[0];
    if (!file) return;

    // 限制文件大小
    if (file.size > 5 * 1024 * 1024) {
        showToast('文件过大，最大支持 5MB');
        e.target.value = '';
        return;
    }

    const reader = new FileReader();
    reader.onload = function (event) {
        try {
            const data = JSON.parse(event.target.result);

            if (data.entries && Array.isArray(data.entries)) {
                // 验证数据格式
                const validEntries = data.entries.filter(entry => {
                    return entry &&
                        typeof entry === 'object' &&
                        entry.id &&
                        Validator.isValidDate(entry.date) &&
                        Validator.isValidNumber(entry.profit, 0) &&
                        Validator.isValidNumber(entry.loss, 0);
                }).map(entry => ({
                    id: entry.id,
                    date: entry.date,
                    profit: parseFloat(entry.profit) || 0,
                    loss: parseFloat(entry.loss) || 0,
                    pnl: parseFloat(entry.pnl) || (parseFloat(entry.profit) || 0) - (parseFloat(entry.loss) || 0),
                    note: Validator.sanitizeString(entry.note || ''),
                    createdAt: entry.createdAt || new Date().toISOString()
                }));

                if (validEntries.length === 0) {
                    showToast('没有找到有效的记录');
                    return;
                }

                if (confirm(`确定要导入 ${validEntries.length} 条记录吗？这将覆盖现有数据。`)) {
                    entries = validEntries;
                    if (data.exchangeRate && Validator.isValidNumber(data.exchangeRate, 0.01, 100)) {
                        exchangeRate = data.exchangeRate;
                        elements.exchangeRateInput.value = exchangeRate.toFixed(2);
                        saveExchangeRate();
                    }
                    saveData();
                    updateUI();
                    autoSyncToCloud();
                    showToast('数据导入成功');
                }
            } else {
                showToast('无效的数据格式');
            }
        } catch (err) {
            showToast('导入失败：文件格式错误');
        }
    };
    reader.onerror = () => {
        showToast('读取文件失败');
    };
    reader.readAsText(file);
    e.target.value = '';
}

// 清除所有数据
function clearAllData() {
    if (confirm('确定要清除所有数据吗？此操作不可恢复！')) {
        if (confirm('再次确认：所有记录将被永久删除！')) {
            entries = [];
            saveData();
            updateUI();
            autoSyncToCloud();
            showToast('所有数据已清除');
        }
    }
}

// 自动同步到云端（使用 Gist）- 带重试机制
async function autoSyncToCloud(retryCount = 0) {
    if (!githubToken || !gistId) {
        return false;
    }

    try {
        const data = {
            version: '1.1',
            syncDate: new Date().toISOString(),
            exchangeRate,
            entries,
            accountEntries: accountEntries || []
        };

        const response = await fetchWithTimeout(`https://api.github.com/gists/${gistId}`, {
            method: 'PATCH',
            headers: {
                'Authorization': `token ${githubToken}`,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                files: {
                    'finance-data.json': {
                        content: JSON.stringify(data, null, 2)
                    }
                }
            })
        });

        if (response.ok) {
            isOnline = true;
            // 同步成功，清除脏数据标记
            localStorage.removeItem(CONFIG.SYNC_STATE_KEY);
            updateSyncStatus();
            return true;
        } else {
            const errorText = await response.text();
            console.error('同步失败:', response.status, errorText);

            // 401/403 错误不重试
            if (response.status === 401 || response.status === 403) {
                showToast('Token 无效或已过期，请重新配置');
                return false;
            }

            // 其他错误重试一次
            if (retryCount < 1) {
                await new Promise(r => setTimeout(r, 1000));
                return autoSyncToCloud(retryCount + 1);
            }

            showToast('同步失败，请稍后重试');
            return false;
        }
    } catch (e) {
        console.error('云端同步失败:', e);
        if (retryCount < 1) {
            await new Promise(r => setTimeout(r, 1000));
            return autoSyncToCloud(retryCount + 1);
        }
        return false;
    }
}

// 显示云端配置对话框
function showCloudConfigDialog(isFirstTime = false) {
    // 生成隐藏显示的值
    const maskedToken = githubToken ? `${githubToken.substring(0, 8)}${'•'.repeat(20)}` : '';
    const maskedGistId = gistId ? `${gistId.substring(0, 8)}${'•'.repeat(16)}` : '';

    const dialog = document.createElement('div');
    dialog.className = 'modal-overlay';
    dialog.innerHTML = `
        <div class="modal-content">
            <h3>☁️ 云端同步设置</h3>
            ${isFirstTime ? '<p class="modal-warning">⚠️ 首次使用请配置云端存储，数据将自动同步到 GitHub Gist<br><br>📱 如果您在其他设备已有数据，请使用<b>相同的 Token 和 Gist ID</b>，数据会自动同步过来</p>' : ''}
            <p class="modal-desc">Token 和 Gist ID 仅保存在本地浏览器中，不会上传到任何服务器。</p>
            
            ${!isFirstTime && gistId ? `<p class="modal-info">当前 Gist ID: <code>${escapeHtml(gistId.substring(0, 8))}...</code></p>` : ''}
            
            <div class="modal-form">
                <label>GitHub Token <a href="https://github.com/settings/tokens/new?scopes=gist&description=Crypto%20Journey" target="_blank" rel="noopener noreferrer">获取Token</a></label>
                <input type="password" id="configToken" placeholder="ghp_xxxx..." value="${githubToken ? maskedToken : ''}" data-masked="true" autocomplete="off">
                <small>只需要 gist 权限，不需要 repo 权限</small>
                
                <label>Gist ID <span id="createGistBtn" class="link-btn">创建新Gist</span></label>
                <input type="text" id="configGistId" placeholder="输入已有的Gist ID或点击创建新的" value="${gistId ? maskedGistId : ''}" data-masked="true" autocomplete="off">
                <small>Gist ID 是 URL 中的一串字符，如: gist.github.com/user/<b>abc123</b></small>
                <small style="color: var(--primary-color); font-weight: 500;">💡 多设备同步：填入其他设备使用的 Gist ID 即可同步数据</small>
            </div>
            
            <div class="modal-actions">
                ${isFirstTime ? '' : '<button class="btn" id="cancelConfigBtn">取消</button>'}
                <button class="btn btn-primary" id="saveConfigBtn">保存并同步数据</button>
            </div>
        </div>
    `;

    document.body.appendChild(dialog);

    const tokenInput = document.getElementById('configToken');
    const gistIdInput = document.getElementById('configGistId');

    // 点击输入框时，如果是遮罩值则清空让用户重新输入
    tokenInput.addEventListener('focus', function () {
        if (this.dataset.masked === 'true') {
            this.value = '';
            this.dataset.masked = 'false';
        }
    });

    gistIdInput.addEventListener('focus', function () {
        if (this.dataset.masked === 'true') {
            this.value = '';
            this.dataset.masked = 'false';
        }
    });

    const cancelBtn = document.getElementById('cancelConfigBtn');
    if (cancelBtn) {
        cancelBtn.onclick = () => dialog.remove();
    }

    // 点击遮罩关闭（非首次配置时）
    if (!isFirstTime) {
        dialog.onclick = (e) => {
            if (e.target === dialog) dialog.remove();
        };
    }

    document.getElementById('saveConfigBtn').onclick = async () => {
        const tokenInputEl = document.getElementById('configToken');
        const gistIdInputEl = document.getElementById('configGistId');

        // 如果输入框仍是遮罩状态，使用原有值
        const newToken = tokenInputEl.dataset.masked === 'true' ? githubToken : tokenInputEl.value.trim();
        const newGistId = gistIdInputEl.dataset.masked === 'true' ? gistId : gistIdInputEl.value.trim();

        if (!newToken || !newGistId) {
            showToast('请填写 Token 和 Gist ID');
            return;
        }

        // 只有当Token被修改时才验证格式
        if (tokenInputEl.dataset.masked !== 'true' && !Validator.isValidToken(newToken)) {
            showToast('Token 格式不正确');
            return;
        }

        githubToken = newToken;
        gistId = newGistId;

        saveCredentials();
        dialog.remove();

        showToast('正在从云端加载数据...');
        await loadData();
        updateUI();

        if (!chart) {
            initChart();
        }

        showToast('云端同步已启用');
        updateSyncStatus();
    };

    document.getElementById('createGistBtn').onclick = async () => {
        const tokenInputEl = document.getElementById('configToken');
        // 如果是遮罩状态，使用原有token
        const token = tokenInputEl.dataset.masked === 'true' ? githubToken : tokenInputEl.value.trim();

        if (!token) {
            showToast('请先输入 GitHub Token');
            return;
        }

        // 只有当Token被修改时才验证格式
        if (tokenInputEl.dataset.masked !== 'true' && !Validator.isValidToken(token)) {
            showToast('Token 格式不正确');
            return;
        }

        try {
            showToast('正在创建 Gist...');
            const response = await fetchWithTimeout('https://api.github.com/gists', {
                method: 'POST',
                headers: {
                    'Authorization': `token ${token}`,
                    'Accept': 'application/vnd.github.v3+json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    description: 'Crypto Journey Data',
                    public: false,
                    files: {
                        'finance-data.json': {
                            content: JSON.stringify({ version: '1.0', entries: [] }, null, 2)
                        }
                    }
                })
            });

            if (response.ok) {
                const gist = await response.json();
                document.getElementById('configGistId').value = gist.id;
                showToast('Gist 创建成功！');
            } else {
                const error = await response.json();
                showToast('创建失败: ' + (error.message || '请检查 Token'));
            }
        } catch (e) {
            showToast('创建失败：' + e.message);
        }
    };
}

// 手动同步按钮 - 长按或右键可修改配置
async function syncToGitHub() {
    if (!githubToken || !gistId) {
        showCloudConfigDialog();
        return;
    }
    // 已配置时，弹出选项对话框
    showSyncOptionsDialog();
}

// 显示同步选项对话框
function showSyncOptionsDialog() {
    const maskedGistId = gistId ? `${gistId.substring(0, 8)}${'•'.repeat(16)}` : '';
    const dialog = document.createElement('div');
    dialog.className = 'modal-overlay';
    dialog.innerHTML = `
        <div class="modal-content">
            <h3>☁️ 云端同步</h3>
            <p class="modal-desc">当前 Gist ID: <code>${escapeHtml(maskedGistId)}</code></p>
            <div class="modal-actions" style="flex-direction: column; gap: 10px;">
                <button class="btn btn-primary" id="doSyncBtn" style="width: 100%;">🔄 立即同步</button>
                <button class="btn" id="editConfigBtn" style="width: 100%;">⚙️ 修改云端配置</button>
                <button class="btn" id="cancelSyncBtn" style="width: 100%;">取消</button>
            </div>
        </div>
    `;

    document.body.appendChild(dialog);

    dialog.onclick = (e) => {
        if (e.target === dialog) dialog.remove();
    };

    document.getElementById('cancelSyncBtn').onclick = () => dialog.remove();

    document.getElementById('doSyncBtn').onclick = async () => {
        dialog.remove();
        showToast('正在同步...');
        await autoSyncToCloud();
        showToast('同步完成');
    };

    document.getElementById('editConfigBtn').onclick = () => {
        dialog.remove();
        showCloudConfigDialog(false);
    };
}

// 更新同步状态显示
function updateSyncStatus() {
    const statusEl = document.getElementById('syncStatus');
    if (statusEl) {
        if (isOnline) {
            statusEl.textContent = '已连接云端';
            statusEl.style.color = 'var(--success-color)';
        } else {
            statusEl.textContent = '离线模式';
        }
    }
}

// 格式化工具函数
// 格式化工具函数
function formatUSD(amount) {
    const absAmount = Math.round(Math.abs(amount));
    if (amount < 0) return `-$${absAmount}`;
    if (amount > 0) return `+$${absAmount}`;
    return `$${absAmount}`;
}

function formatCNY(amount) {
    const absAmount = Math.round(Math.abs(amount));
    if (amount < 0) return `-¥${absAmount}`;
    if (amount > 0) return `+¥${absAmount}`;
    return `¥${absAmount}`;
}

function formatDate(dateStr) {
    const date = DateUtil.parseLocalDate(dateStr);
    const options = { year: 'numeric', month: 'short', day: 'numeric', weekday: 'short' };
    return date.toLocaleDateString('zh-CN', options);
}

function formatShortDate(dateStr) {
    const date = DateUtil.parseLocalDate(dateStr);
    return `${date.getMonth() + 1}/${date.getDate()}`;
}

function formatTime(isoString) {
    const date = new Date(isoString);
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Toast 提示（带去重）
let toastTimer = null;
function showToast(message) {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    clearTimeout(toastTimer);

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    toast.setAttribute('role', 'alert');
    toast.setAttribute('aria-live', 'polite');

    document.body.appendChild(toast);

    toastTimer = setTimeout(() => toast.remove(), CONFIG.TOAST_DURATION);
}

// 启动后台同步循环
function startBackgroundSync() {
    // 1. 定时检查
    setInterval(() => {
        if (localStorage.getItem(CONFIG.SYNC_STATE_KEY) === 'true' && navigator.onLine) {
            console.log('后台触发同步...');
            autoSyncToCloud();
        }
    }, CONFIG.BACKGROUND_SYNC_INTERVAL);

    // 2. 网络恢复时检查
    window.addEventListener('online', () => {
        if (localStorage.getItem(CONFIG.SYNC_STATE_KEY) === 'true') {
            console.log('网络恢复，触发同步...');
            showToast('网络已恢复，正在同步...');
            autoSyncToCloud();
        }
    });

    // 3. 页面获得焦点时检查（防止长时间挂起后恢复）
    window.addEventListener('focus', () => {
        if (localStorage.getItem(CONFIG.SYNC_STATE_KEY) === 'true' && navigator.onLine) {
            // 稍作延迟避免冲突
            setTimeout(() => {
                console.log('页面激活，触发同步...');
                autoSyncToCloud();
            }, 1000);
        }
    });
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', init);



window.addEventListener('offline', () => {
    showToast('网络已断开，数据将保存在本地');
    isOnline = false;
    updateSyncStatus();
});

// 暴露删除函数到全局
window.deleteEntry = deleteEntry;

// ==================== 账户记账模块 ====================
const ACCOUNTS_STORAGE_KEY = 'cryptoAccountsData';
let accountEntries = [];
let accountsChart = null;

// 加载账户数据
function loadAccountsData() {
    const stored = localStorage.getItem(ACCOUNTS_STORAGE_KEY);
    if (stored) {
        try {
            accountEntries = JSON.parse(stored);
        } catch (e) {
            accountEntries = [];
        }
    }
}

// 保存账户数据
function saveAccountsData() {
    localStorage.setItem(ACCOUNTS_STORAGE_KEY, JSON.stringify(accountEntries));
    // 标记为需要同步
    localStorage.setItem(CONFIG.SYNC_STATE_KEY, 'true');
}

// 初始化账户模块
function initAccountsModule() {
    // loadAccountsData(); // 已在 init() 中提前加载，避免覆盖问题
    bindAccountsEvents();
    updateAccountsDisplay();
    initAccountsChart();
}

// 绑定账户模块事件
function bindAccountsEvents() {
    const addBtn = document.getElementById('addAccountEntryBtn');
    const modal = document.getElementById('accountModal');
    const closeBtn = document.getElementById('closeAccountModalBtn');
    const form = document.getElementById('accountForm');

    if (addBtn && modal) {
        addBtn.addEventListener('click', () => {
            document.getElementById('accountDate').value = DateUtil.getToday();
            // 预填充最新数据
            if (accountEntries.length > 0) {
                const latest = accountEntries[0];
                document.getElementById('binanceAmount').value = latest.binance || '';
                document.getElementById('okxAmount').value = latest.okx || '';
                document.getElementById('walletAmount').value = latest.wallet || '';
            }
            modal.style.display = 'flex';
        });
    }

    if (closeBtn && modal) {
        closeBtn.addEventListener('click', () => {
            modal.style.display = 'none';
        });
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.style.display = 'none';
        });
    }

    if (form) {
        form.addEventListener('submit', handleAccountFormSubmit);
    }
}

// 处理账户表单提交（乐观更新：本地立即生效，云端异步同步）
function handleAccountFormSubmit(e) {
    e.preventDefault();

    const date = document.getElementById('accountDate').value;
    const binance = parseFloat(document.getElementById('binanceAmount').value) || 0;
    const okx = parseFloat(document.getElementById('okxAmount').value) || 0;
    const wallet = parseFloat(document.getElementById('walletAmount').value) || 0;

    if (!date || !Validator.isValidDate(date)) {
        showToast('请选择有效日期');
        return;
    }

    const total = binance + okx + wallet;

    // 检查是否已有该日期的记录，有则更新
    const existingIndex = accountEntries.findIndex(e => e.date === date);
    const entry = {
        id: existingIndex >= 0 ? accountEntries[existingIndex].id : Date.now(),
        date,
        binance,
        okx,
        wallet,
        total,
        createdAt: new Date().toISOString()
    };

    const isUpdate = existingIndex >= 0;
    if (isUpdate) {
        accountEntries[existingIndex] = entry;
    } else {
        accountEntries.push(entry);
    }

    // 按日期排序（最新在前）
    accountEntries.sort((a, b) => new Date(b.date) - new Date(a.date));

    // 1. 本地立即保存
    saveAccountsData();
    
    // 2. 立即更新 UI
    updateAccountsDisplay();
    updateAccountsChart();

    // 3. 立即关闭弹窗
    document.getElementById('accountModal').style.display = 'none';

    // 4. 显示本地成功提示
    showToast(isUpdate ? '记录已更新' : '记录已添加');

    // 5. 异步后台同步到云端（不阻塞用户操作）
    autoSyncToCloud().then(syncSuccess => {
        if (syncSuccess) {
            showToast('已同步到云端');
        }
        // 同步失败时不打扰用户，后台会自动重试
    });
}

// 更新账户显示
function updateAccountsDisplay() {
    // 显示最新记录的数据
    if (accountEntries.length > 0) {
        const latest = accountEntries[0];

        document.getElementById('binanceValue').textContent = `$${Math.round(latest.binance).toLocaleString()} `;
        document.getElementById('binanceValueCNY').textContent = `¥${Math.round(latest.binance * exchangeRate).toLocaleString()} `;

        document.getElementById('okxValue').textContent = `$${Math.round(latest.okx).toLocaleString()} `;
        document.getElementById('okxValueCNY').textContent = `¥${Math.round(latest.okx * exchangeRate).toLocaleString()} `;

        document.getElementById('walletValue').textContent = `$${Math.round(latest.wallet).toLocaleString()} `;
        document.getElementById('walletValueCNY').textContent = `¥${Math.round(latest.wallet * exchangeRate).toLocaleString()} `;

        document.getElementById('totalAssets').textContent = `$${Math.round(latest.total).toLocaleString()} `;
        document.getElementById('totalAssetsCNY').textContent = `¥${Math.round(latest.total * exchangeRate).toLocaleString()} `;
    } else {
        document.getElementById('binanceValue').textContent = '$0';
        document.getElementById('binanceValueCNY').textContent = '¥0';
        document.getElementById('okxValue').textContent = '$0';
        document.getElementById('okxValueCNY').textContent = '¥0';
        document.getElementById('walletValue').textContent = '$0';
        document.getElementById('walletValueCNY').textContent = '¥0';
        document.getElementById('totalAssets').textContent = '$0';
        document.getElementById('totalAssetsCNY').textContent = '¥0';
    }

    // 渲染历史记录
    renderAccountsHistory();
}

// 渲染账户历史记录
function renderAccountsHistory() {
    const list = document.getElementById('accountsHistoryList');
    if (!list) return;

    if (accountEntries.length === 0) {
        list.innerHTML = '<p class="empty-state">暂无记录</p>';
        return;
    }

    const html = accountEntries.slice(0, 30).map(entry => `
        <div class="account-history-item" data-id="${entry.id}">
            <span class="account-history-date">${formatDateCompact(entry.date)}</span>
            <div class="account-history-values">
                <span>🟡 $${Math.round(entry.binance).toLocaleString()}</span>
                <span>⚫ $${Math.round(entry.okx).toLocaleString()}</span>
                <span>👛 $${Math.round(entry.wallet).toLocaleString()}</span>
                <span class="account-history-total">= $${Math.round(entry.total).toLocaleString()}</span>
            </div>
            <div class="account-history-actions">
                <button class="delete-btn" onclick="deleteAccountEntry(${entry.id})" title="删除">🗑️</button>
            </div>
        </div>
        `).join('');

    list.innerHTML = html;
}

// 删除账户记录
function deleteAccountEntry(id) {
    if (confirm('确定要删除这条记录吗？')) {
        accountEntries = accountEntries.filter(e => e.id !== id);
        saveAccountsData();
        updateAccountsDisplay();
        updateAccountsChart();
        autoSyncToCloud();
        showToast('记录已删除');
    }
}
window.deleteAccountEntry = deleteAccountEntry;

// 初始化账户趋势图
function initAccountsChart() {
    const canvas = document.getElementById('accountsChart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');

    accountsChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                {
                    label: '总资产',
                    data: [],
                    borderColor: '#4f46e5',
                    backgroundColor: 'rgba(79, 70, 229, 0.1)',
                    fill: true,
                    tension: 0.3,
                    borderWidth: 2
                },
                {
                    label: '币安',
                    data: [],
                    borderColor: '#f0b90b',
                    backgroundColor: 'transparent',
                    tension: 0.3,
                    borderWidth: 1.5,
                    borderDash: [5, 5]
                },
                {
                    label: '欧易',
                    data: [],
                    borderColor: '#121212',
                    backgroundColor: 'transparent',
                    tension: 0.3,
                    borderWidth: 1.5,
                    borderDash: [5, 5]
                },
                {
                    label: '钱包',
                    data: [],
                    borderColor: '#7c3aed',
                    backgroundColor: 'transparent',
                    tension: 0.3,
                    borderWidth: 1.5,
                    borderDash: [5, 5]
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: true,
                    position: 'bottom',
                    labels: {
                        boxWidth: 12,
                        padding: 10,
                        font: { size: 11 }
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            return `${context.dataset.label}: $${Math.round(context.raw).toLocaleString()} `;
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: false,
                    grid: { color: 'rgba(0, 0, 0, 0.05)' }
                },
                x: {
                    grid: { display: false }
                }
            }
        }
    });

    updateAccountsChart();
}

// 更新账户趋势图
function updateAccountsChart() {
    if (!accountsChart) return;

    // 取最近30条记录，按日期正序
    const data = accountEntries.slice(0, 30).reverse();

    const labels = data.map(e => formatShortDate(e.date));
    const totals = data.map(e => e.total);
    const binanceData = data.map(e => e.binance);
    const okxData = data.map(e => e.okx);
    const walletData = data.map(e => e.wallet);

    accountsChart.data.labels = labels;
    accountsChart.data.datasets[0].data = totals;
    accountsChart.data.datasets[1].data = binanceData;
    accountsChart.data.datasets[2].data = okxData;
    accountsChart.data.datasets[3].data = walletData;

    accountsChart.update();
}


