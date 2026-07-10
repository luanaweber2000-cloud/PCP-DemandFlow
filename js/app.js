// PCP DemandFlow - Application Logic

// --- App State ---
let tasks = [];
let completed = [];
let cancelled = [];

let config = {
    prodStart: '', // Initialized to today at 08:00
    shiftStart: '08:00',
    shiftEnd: '16:30',
    lunchStart: '12:00',
    lunchDuration: 60, // minutes
    weekdays: [1, 2, 3, 4, 5], // Monday to Friday (Sunday=0, Saturday=6)
    overtimes: [],
    absences: []
};

// Temporary ID for modal operations
let activeModalTaskId = null;
let supabaseClient = null;

// --- Initialization ---
document.addEventListener('DOMContentLoaded', async () => {
    initDefaultConfig();
    initSupabase();
    setupEventListeners();
    await setupAuth();
    if (!supabaseClient) {
        await loadState();
        runSixMonthsRetention();
        recalculateSchedule();
        renderAll();
    }
});

// Setup default starting date and configuration
function initDefaultConfig() {
    const now = new Date();
    // Default start date: today at 08:00
    const todayEight = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 8, 0, 0, 0);
    config.prodStart = formatDateTimeLocal(todayEight);
    
    // Set initial input value in UI
    document.getElementById('prod-start').value = config.prodStart;
}

// Format Date object to YYYY-MM-DDTHH:MM for datetime-local inputs
function formatDateTimeLocal(date) {
    const pad = (num) => String(num).padStart(2, '0');
    const yyyy = date.getFullYear();
    const mm = pad(date.getMonth() + 1);
    const dd = pad(date.getDate());
    const hh = pad(date.getHours());
    const min = pad(date.getMinutes());
    return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

// Format Date to friendly string: DD/MM HH:MM
function formatFriendlyDateTime(date) {
    if (!date) return '--/-- --:--';
    const d = new Date(date);
    const pad = (num) => String(num).padStart(2, '0');
    const day = pad(d.getDate());
    const month = pad(d.getMonth() + 1);
    const hours = pad(d.getHours());
    const minutes = pad(d.getMinutes());
    return `${day}/${month} ${hours}:${minutes}`;
}

// Format yyyy-mm-dd to friendly string: DD/MM (weekday)
function formatFriendlyDate(dateStr) {
    if (!dateStr) return '--/--';
    const dateParts = dateStr.split('-');
    if (dateParts.length < 3) return dateStr;
    const localDate = new Date(dateParts[0], dateParts[1] - 1, dateParts[2]);
    const weekdayStr = localDate.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
    return `${dateParts[2]}/${dateParts[1]} (${weekdayStr})`;
}

// Convert minutes to friendly text: Xh YYm
function formatFriendlyDuration(totalMins) {
    const hours = Math.floor(totalMins / 60);
    const mins = Math.round(totalMins % 60);
    if (hours === 0) return `${mins} min`;
    return `${hours}h ${String(mins).padStart(2, '0')}m`;
}

// --- LocalStorage & Data Retention ---
function syncConfigToUI() {
    if (config.prodStart) document.getElementById('prod-start').value = config.prodStart;
    if (config.shiftStart) document.getElementById('shift-start').value = config.shiftStart;
    if (config.shiftEnd) document.getElementById('shift-end').value = config.shiftEnd;
    if (config.lunchStart) document.getElementById('lunch-start').value = config.lunchStart;
    if (config.lunchDuration !== undefined) document.getElementById('lunch-duration').value = config.lunchDuration;
    
    // Update weekday buttons
    document.querySelectorAll('.day-btn').forEach(btn => {
        const dayNum = parseInt(btn.dataset.day);
        if (config.weekdays.includes(dayNum)) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    // Renderiza a lista de horas extras na lateral
    renderOvertimes();

    // Renderiza a lista de faltas/feriados na lateral
    renderAbsences();
}

async function loadState() {
    // 1. Tenta carregar do Supabase se configurado
    if (supabaseClient) {
        try {
            // Verifica se há usuário logado
            const sessionRes = await supabaseClient.auth.getSession();
            const session = sessionRes.data?.session;
            if (!session) {
                console.warn('Sem sessão ativa no Supabase. Ocultando dados até o login.');
                return;
            }

            const { data, error } = await supabaseClient
                .from('MerketingCheck')
                .select('state')
                .eq('id', 1)
                .single();
            
            if (!error && data && data.state && Object.keys(data.state).length > 0) {
                const s = data.state;
                if (s.config) config = { ...config, ...s.config };
                if (s.tasks) tasks = s.tasks;
                if (s.completed) completed = s.completed;
                if (s.cancelled) cancelled = s.cancelled;
                
                syncConfigToUI();
                console.log('Dados PCP carregados com sucesso do Supabase.');
                // Salva no localStorage como backup local
                localStorage.setItem('pcp_config', JSON.stringify(config));
                localStorage.setItem('pcp_tasks', JSON.stringify(tasks));
                localStorage.setItem('pcp_completed', JSON.stringify(completed));
                localStorage.setItem('pcp_cancelled', JSON.stringify(cancelled));
                return;
            } else {
                console.warn('Nenhum dado retornado ou tabela vazia no Supabase, tentando local. Erro:', error);
            }
        } catch (err) {
            console.error('Falha ao carregar dados do Supabase:', err);
        }
    }

    // 2. Tenta carregar do servidor local
    try {
        const response = await fetch('/api/data');
        if (response.ok) {
            const data = await response.json();
            if (data && (data.tasks || data.config || data.completed || data.cancelled)) {
                if (data.config) config = { ...config, ...data.config };
                if (data.tasks) tasks = data.tasks;
                if (data.completed) completed = data.completed;
                if (data.cancelled) cancelled = data.cancelled;
                
                syncConfigToUI();
                console.log('Dados PCP carregados com sucesso do servidor local.');
                return;
            }
        }
    } catch (err) {
        console.warn('Servidor local inacessível ou erro ao ler dados. Usando localStorage:', err);
    }

    // 3. Fallback para LocalStorage se o servidor falhar ou estiver vazio
    const storedConfig = localStorage.getItem('pcp_config');
    const storedTasks = localStorage.getItem('pcp_tasks');
    const storedCompleted = localStorage.getItem('pcp_completed');
    const storedCancelled = localStorage.getItem('pcp_cancelled');

    if (storedConfig) {
        config = { ...config, ...JSON.parse(storedConfig) };
        syncConfigToUI();
    }
    
    if (storedTasks) tasks = JSON.parse(storedTasks);
    if (storedCompleted) completed = JSON.parse(storedCompleted);
    if (storedCancelled) cancelled = JSON.parse(storedCancelled);
}

async function saveState() {
    const backupData = {
        config,
        tasks,
        completed,
        cancelled,
        exportedAt: Date.now()
    };

    // Sempre grava no localStorage como backup local no navegador
    localStorage.setItem('pcp_config', JSON.stringify(config));
    localStorage.setItem('pcp_tasks', JSON.stringify(tasks));
    localStorage.setItem('pcp_completed', JSON.stringify(completed));
    localStorage.setItem('pcp_cancelled', JSON.stringify(cancelled));

    // Grava no Supabase se configurado
    if (supabaseClient) {
        try {
            const sessionRes = await supabaseClient.auth.getSession();
            const session = sessionRes.data?.session;
            if (session) {
                const { error } = await supabaseClient
                    .from('MerketingCheck')
                    .upsert({ id: 1, state: backupData });
                
                if (error) {
                    console.error('Erro ao salvar dados no Supabase:', error);
                } else {
                    console.log('Dados PCP salvos com sucesso no Supabase.');
                }
            } else {
                console.warn('Tentativa de salvar dados ignorada pois o usuário não está autenticado no Supabase.');
            }
        } catch (err) {
            console.error('Falha de rede ao salvar no Supabase:', err);
        }
    }

    // Tenta gravar no servidor local
    try {
        await fetch('/api/data', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(backupData)
        });
    } catch (err) {
        console.warn('Erro ao salvar dados no servidor local:', err);
    }
}

// Remove records older than 6 months (180 days)
function runSixMonthsRetention() {
    const sixMonthsAgo = Date.now() - (180 * 24 * 60 * 60 * 1000);
    
    const originalCompletedLength = completed.length;
    const originalCancelledLength = cancelled.length;

    completed = completed.filter(item => item.completedAt ? item.completedAt > sixMonthsAgo : true);
    cancelled = cancelled.filter(item => item.cancelledAt ? item.cancelledAt > sixMonthsAgo : true);

    if (completed.length !== originalCompletedLength || cancelled.length !== originalCancelledLength) {
        saveState();
        console.log('Dados expirados (+6 meses) foram limpos.');
    }
}

// --- Schedule Recalculation Engine ---
function reorganizeQueue() {
    // 1. Separar tarefas ativas (iniciadas) - elas devem continuar no topo na ordem atual
    const active = tasks.filter(t => t.status === 'iniciado');
    
    // 2. Pegar as demais tarefas (em fila ou pausadas)
    const remaining = tasks.filter(t => t.status !== 'iniciado');
    
    // 3. Separar em tarefas com prazo fixo e tarefas normais
    const withDeadline = remaining.filter(t => t.fixedDeadline);
    const noDeadline = remaining.filter(t => !t.fixedDeadline);
    
    // 4. Ordenar tarefas com prazo fixo por data (mais urgente primeiro)
    withDeadline.sort((a, b) => new Date(a.fixedDeadline) - new Date(b.fixedDeadline));
    
    // 5. Unir tudo novamente
    tasks = [...active, ...withDeadline, ...noDeadline];
}

function recalculateSchedule() {
    if (tasks.length === 0) {
        return;
    }

    // Reorganiza a fila para priorizar os prazos fixos antes do cálculo de cronograma
    reorganizeQueue();

    // Determine the base starting time
    let currentTime = new Date(config.prodStart);
    
    // Rule: chain calculations after the last completed task if it exists and is newer than start config
    if (completed.length > 0) {
        const lastCompleted = completed[completed.length - 1];
        const lastCompletedEnd = new Date(lastCompleted.actualEnd);
        if (lastCompletedEnd > currentTime) {
            currentTime = lastCompletedEnd;
        }
    }

    const now = new Date();

    // Iterate through all active tasks in the queue
    tasks.forEach(task => {
        // Paused tasks do not take production capacity (0 active time)
        if (task.status === 'pausado') {
            task.plannedStart = null;
            task.plannedEnd = null;
            task.isDelayed = false;
            task.missesDeadline = false;
            return;
        }

        // 1. Find the starting date/time adjusted to shifts and working days
        currentTime = adjustToWorkingHours(currentTime, config);
        
        // Se a data de solicitação for posterior ao início planejado, ajusta para iniciar apenas pós solicitação
        if (task.requestedAt) {
            const reqDate = new Date(task.requestedAt);
            if (reqDate > currentTime) {
                currentTime = reqDate;
                currentTime = adjustToWorkingHours(currentTime, config);
            }
        }
        task.plannedStart = currentTime.toISOString();

        // 2. Add duration minutes taking breaks and shifts into account
        const plannedEnd = addWorkingMinutes(currentTime, task.duration, config);
        task.plannedEnd = plannedEnd.toISOString();

        // 3. Check for delay: if started and exceeds estimated deadline
        if (task.status === 'iniciado') {
            if (now > plannedEnd) {
                task.isDelayed = true;
                currentTime = new Date(now);
            } else {
                task.isDelayed = false;
                currentTime = new Date(plannedEnd);
            }
        } else {
            task.isDelayed = false;
            currentTime = new Date(plannedEnd);
        }

        // 4. Verifica se a tarefa vai estourar o prazo de entrega fixo estabelecido
        if (task.fixedDeadline && task.plannedEnd) {
            const plannedEndVal = new Date(task.plannedEnd);
            const deadlineVal = new Date(task.fixedDeadline);
            task.missesDeadline = plannedEndVal > deadlineVal;
        } else {
            task.missesDeadline = false;
        }
    });
}

// Helper to get overtime for a given Date
function getOvertimeForDate(dateObj, cfg) {
    if (!cfg.overtimes || cfg.overtimes.length === 0) return null;
    const pad = (n) => String(n).padStart(2, '0');
    const dateStr = `${dateObj.getFullYear()}-${pad(dateObj.getMonth() + 1)}-${pad(dateObj.getDate())}`;
    return cfg.overtimes.find(ot => ot.date === dateStr);
}

// Helper to get absences for a given Date
function getAbsencesForDate(dateObj, cfg) {
    if (!cfg.absences || cfg.absences.length === 0) return [];
    const pad = (n) => String(n).padStart(2, '0');
    const dateStr = `${dateObj.getFullYear()}-${pad(dateObj.getMonth() + 1)}-${pad(dateObj.getDate())}`;
    return cfg.absences.filter(abs => abs.date === dateStr);
}

// Helper to subtract a sub-interval from a working window
function subtractInterval(w, sub) {
    if (sub.end <= w.start || sub.start >= w.end) {
        return [w];
    }
    const result = [];
    if (sub.start > w.start) {
        result.push({ start: w.start, end: sub.start, type: w.type });
    }
    if (sub.end < w.end) {
        result.push({ start: sub.end, end: w.end, type: w.type });
    }
    return result;
}

// Helper to calculate all active working windows for a calendar day
function getActiveWindowsForDay(dateObj, cfg) {
    const windows = [];
    
    // 1. Standard Shift (if it is a registered working day)
    const dayOfWeek = dateObj.getDay();
    if (cfg.weekdays.includes(dayOfWeek)) {
        const [sh, sm] = cfg.shiftStart.split(':').map(Number);
        const [eh, em] = cfg.shiftEnd.split(':').map(Number);
        const [lh, lm] = cfg.lunchStart.split(':').map(Number);
        const lunchDur = cfg.lunchDuration;
        
        const shiftStartMin = sh * 60 + sm;
        const shiftEndMin = eh * 60 + em;
        const lunchStartMin = lh * 60 + lm;
        const lunchEndMin = lunchStartMin + lunchDur;
        
        if (lunchDur > 0 && lunchStartMin > shiftStartMin && lunchStartMin < shiftEndMin) {
            // Split standard shift by lunch break
            windows.push({ start: shiftStartMin, end: lunchStartMin, type: 'shift' });
            windows.push({ start: lunchEndMin, end: shiftEndMin, type: 'shift' });
        } else {
            windows.push({ start: shiftStartMin, end: shiftEndMin, type: 'shift' });
        }
    }
    
    // 2. Overtime Shift (if registered for this specific date)
    const ot = getOvertimeForDate(dateObj, cfg);
    if (ot) {
        const [oth_s, otm_s] = ot.startTime.split(':').map(Number);
        const [oth_e, otm_e] = ot.endTime.split(':').map(Number);
        windows.push({ start: oth_s * 60 + otm_s, end: oth_e * 60 + otm_e, type: 'overtime' });
    }
    
    // Sort windows by start time and merge any overlapping/adjacent slots
    windows.sort((a, b) => a.start - b.start);
    
    const merged = [];
    windows.forEach(w => {
        if (merged.length === 0) {
            merged.push(w);
        } else {
            const last = merged[merged.length - 1];
            if (w.start <= last.end) {
                last.end = Math.max(last.end, w.end);
            } else {
                merged.push(w);
            }
        }
    });
    
    // 3. Subtract any scheduled absences (faltas/feriados) for this calendar date
    const absences = getAbsencesForDate(dateObj, cfg);
    let currentWindows = merged;
    
    absences.forEach(abs => {
        const [abs_s, abs_m] = abs.startTime.split(':').map(Number);
        const [abs_e, abs_m2] = abs.endTime.split(':').map(Number);
        const subRange = { start: abs_s * 60 + abs_m, end: abs_e * 60 + abs_m2 };
        
        const nextRound = [];
        currentWindows.forEach(w => {
            nextRound.push(...subtractInterval(w, subRange));
        });
        currentWindows = nextRound;
    });
    
    return currentWindows;
}

// Adjust a datetime to the next closest active working minute
function adjustToWorkingHours(dateObj, cfg) {
    let date = new Date(dateObj);
    
    let safetyCounter = 0;
    while (safetyCounter < 1000) {
        safetyCounter++;
        
        const activeWindows = getActiveWindowsForDay(date, cfg);
        
        if (activeWindows.length === 0) {
            // Move to next day at midnight
            date.setDate(date.getDate() + 1);
            date.setHours(0, 0, 0, 0);
            continue;
        }
        
        const currentMins = date.getHours() * 60 + date.getMinutes();
        
        let foundWindow = null;
        let nextWindow = null;
        
        for (let w of activeWindows) {
            if (currentMins >= w.start && currentMins < w.end) {
                foundWindow = w;
                break;
            }
            if (w.start > currentMins && !nextWindow) {
                nextWindow = w;
            }
        }
        
        if (foundWindow) {
            break;
        }
        
        if (nextWindow) {
            // Move to start of next work window today
            date.setHours(Math.floor(nextWindow.start / 60), nextWindow.start % 60, 0, 0);
            break;
        }
        
        // Move to next day
        date.setDate(date.getDate() + 1);
        date.setHours(0, 0, 0, 0);
    }
    
    return date;
}

// Add working minutes using the active calendar windows
function addWorkingMinutes(startDate, minutesToAdd, cfg) {
    let date = new Date(startDate);
    let minsRemaining = minutesToAdd;
    
    let safetyCounter = 0;
    while (minsRemaining > 0 && safetyCounter < 5000) {
        safetyCounter++;
        
        date = adjustToWorkingHours(date, cfg);
        
        const activeWindows = getActiveWindowsForDay(date, cfg);
        const currentMins = date.getHours() * 60 + date.getMinutes();
        
        const currentWindow = activeWindows.find(w => currentMins >= w.start && currentMins < w.end);
        
        if (!currentWindow) {
            date.setDate(date.getDate() + 1);
            date.setHours(0, 0, 0, 0);
            continue;
        }
        
        const minsAvailable = currentWindow.end - currentMins;
        const minsToUse = Math.min(minsRemaining, minsAvailable);
        
        date.setMinutes(date.getMinutes() + minsToUse);
        minsRemaining -= minsToUse;
    }
    
    return date;
}

// --- Event Listeners ---
function setupEventListeners() {
    // Shift changes
    document.getElementById('prod-start').addEventListener('change', (e) => {
        config.prodStart = e.target.value;
        saveState();
        recalculateSchedule();
        renderAll();
    });
    document.getElementById('shift-start').addEventListener('change', (e) => {
        config.shiftStart = e.target.value;
        saveState();
        recalculateSchedule();
        renderAll();
    });
    document.getElementById('shift-end').addEventListener('change', (e) => {
        config.shiftEnd = e.target.value;
        saveState();
        recalculateSchedule();
        renderAll();
    });
    document.getElementById('lunch-start').addEventListener('change', (e) => {
        config.lunchStart = e.target.value;
        saveState();
        recalculateSchedule();
        renderAll();
    });
    document.getElementById('lunch-duration').addEventListener('change', (e) => {
        config.lunchDuration = parseInt(e.target.value) || 0;
        saveState();
        recalculateSchedule();
        renderAll();
    });

    // Weekday toggle
    document.querySelectorAll('.day-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const dayNum = parseInt(btn.dataset.day);
            if (config.weekdays.includes(dayNum)) {
                // Keep at least one working day
                if (config.weekdays.length > 1) {
                    config.weekdays = config.weekdays.filter(d => d !== dayNum);
                    btn.classList.remove('active');
                }
            } else {
                config.weekdays.push(dayNum);
                btn.classList.add('active');
            }
            saveState();
            recalculateSchedule();
            renderAll();
        });
    });

    // Form Submission: Add demand
    const form = document.getElementById('task-form');
    form.addEventListener('submit', (e) => {
        e.preventDefault();
        
        const name = document.getElementById('task-name').value.trim();
        const material = document.getElementById('material-name').value.trim();
        const requestor = document.getElementById('task-requestor').value.trim();
        const qty = parseInt(document.getElementById('quantity').value) || 1;
        const unitTime = parseFloat(document.getElementById('unit-time').value) || 1;
        const unit = document.getElementById('time-unit').value;
        
        // Captura o prazo fixo definido (se houver) com tratamento de erros de conversão
        const fixedDeadlineVal = document.getElementById('fixed-deadline').value;
        let fixedDeadline = null;
        if (fixedDeadlineVal) {
            try {
                const d = new Date(fixedDeadlineVal.replace(' ', 'T'));
                if (!isNaN(d.getTime())) {
                    fixedDeadline = d.toISOString();
                }
            } catch (err) {
                console.error('Erro ao converter data de prazo fixo:', err);
            }
        }
        
        // Captura a data de solicitação definida com tratamento de erros de conversão
        const requestDateVal = document.getElementById('request-date').value;
        let requestedAt = new Date().toISOString();
        if (requestDateVal) {
            try {
                const d = new Date(requestDateVal.replace(' ', 'T'));
                if (!isNaN(d.getTime())) {
                    requestedAt = d.toISOString();
                }
            } catch (err) {
                console.error('Erro ao converter data de solicitação:', err);
            }
        }
        
        // Captura o texto explicativo
        const description = document.getElementById('task-description').value.trim();
        
        // Calculate duration in minutes
        let duration = qty * unitTime;
        if (unit === 'hour') {
            duration = duration * 60;
        }
        
        const newTask = {
            id: 'task_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
            name,
            material,
            requestor,
            qty,
            unitTime,
            unit,
            duration: Math.round(duration),
            status: 'fila', // Default status: fila
            startedAt: null,
            plannedStart: null,
            plannedEnd: null,
            fixedDeadline: fixedDeadline,
            missesDeadline: false,
            requestedAt: requestedAt,
            description: description
        };
        
        tasks.push(newTask);
        saveState();
        recalculateSchedule();
        renderAll();
        
        // Fecha o modal após adicionar
        closeTaskModal();
    });

    // Inputs listener for live time preview
    document.getElementById('quantity').addEventListener('input', updateTimePreview);
    document.getElementById('unit-time').addEventListener('input', updateTimePreview);
    document.getElementById('time-unit').addEventListener('change', updateTimePreview);

    // Tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const targetTab = btn.dataset.tab;
            
            // Switch tabs
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            
            btn.classList.add('active');
            document.getElementById(targetTab).classList.add('active');
        });
    });

    // Modals buttons confirmation
    document.getElementById('confirm-cancel-btn').addEventListener('click', confirmCancellation);
    document.getElementById('confirm-complete-btn').addEventListener('click', confirmCompletion);
    
    const confirmDeleteBtn = document.getElementById('confirm-delete-btn');
    if (confirmDeleteBtn) {
        const newConfirmDeleteBtn = confirmDeleteBtn.cloneNode(true);
        confirmDeleteBtn.parentNode.replaceChild(newConfirmDeleteBtn, confirmDeleteBtn);
        newConfirmDeleteBtn.addEventListener('click', () => {
            if (globalDeleteCallback) {
                globalDeleteCallback();
                closeDeleteConfirmModal();
            }
        });
    }
    
    // Abre o modal de nova demanda
    document.getElementById('btn-open-task-modal').addEventListener('click', openTaskModal);
    
    // Abre o modal de hora extra
    document.getElementById('btn-open-overtime-modal').addEventListener('click', openOvertimeModal);
    
    // Submissão do formulário de hora extra
    const otForm = document.getElementById('overtime-form');
    if (otForm) {
        otForm.addEventListener('submit', (e) => {
            e.preventDefault();
            
            const date = document.getElementById('overtime-date').value;
            const startTime = document.getElementById('overtime-start').value;
            const endTime = document.getElementById('overtime-end').value;
            
            if (!config.overtimes) {
                config.overtimes = [];
            }
            
            const isOverlap = config.overtimes.some(ot => ot.date === date && ot.startTime === startTime && ot.endTime === endTime);
            if (isOverlap) {
                alert('Esta hora extra já está cadastrada!');
                return;
            }
            
            const newOt = {
                id: 'ot_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
                date,
                startTime,
                endTime
            };
            
            config.overtimes.push(newOt);
            saveState();
            recalculateSchedule();
            renderAll();
            
            closeOvertimeModal();
        });
    }
    
    // Abre o modal de falta/feriado
    document.getElementById('btn-open-absence-modal').addEventListener('click', openAbsenceModal);
    
    const absenceAllDay = document.getElementById('absence-all-day');
    if (absenceAllDay) {
        absenceAllDay.addEventListener('change', () => {
            const startInput = document.getElementById('absence-start');
            const endInput = document.getElementById('absence-end');
            if (absenceAllDay.checked) {
                startInput.value = config.shiftStart || '08:00';
                endInput.value = config.shiftEnd || '16:30';
                startInput.disabled = true;
                endInput.disabled = true;
            } else {
                startInput.disabled = false;
                endInput.disabled = false;
            }
        });
    }
    
    // Submissão do formulário de falta/feriado
    const absForm = document.getElementById('absence-form');
    if (absForm) {
        absForm.addEventListener('submit', (e) => {
            e.preventDefault();
            
            const date = document.getElementById('absence-date').value;
            const startTime = document.getElementById('absence-start').value;
            const endTime = document.getElementById('absence-end').value;
            
            if (!config.absences) {
                config.absences = [];
            }
            
            const isOverlap = config.absences.some(abs => abs.date === date && abs.startTime === startTime && abs.endTime === endTime);
            if (isOverlap) {
                alert('Esta falta/feriado já está cadastrado!');
                return;
            }
            
            const newAbs = {
                id: 'abs_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
                date,
                startTime,
                endTime
            };
            
            config.absences.push(newAbs);
            saveState();
            recalculateSchedule();
            renderAll();
            
            closeAbsenceModal();
        });
    }
    
    // Close modals on overlay click
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                closeCancelModal();
                closeCompleteModal();
                closeTaskModal();
                closeOvertimeModal();
                closeAbsenceModal();
                closeReportModal();
                closePauseModal();
            }
        });
    });

    // Abre o modal de exportar relatório (com verificação nula caso o painel esteja desativado)
    const btnReport = document.getElementById('btn-open-report-modal');
    if (btnReport) {
        btnReport.addEventListener('click', openReportModal);
    }
    
    // Submissão do formulário de relatório
    const repForm = document.getElementById('report-form');
    if (repForm) {
        repForm.addEventListener('submit', (e) => {
            e.preventDefault();
            
            const email = document.getElementById('report-email').value.trim();
            const incQueue = document.getElementById('rep-queue').checked;
            const incCompleted = document.getElementById('rep-completed').checked;
            const incCancelled = document.getElementById('rep-cancelled').checked;
            
            if (!incQueue && !incCompleted && !incCancelled) {
                alert('Selecione pelo menos uma seção para o relatório!');
                return;
            }
            
            // 1. Gera o relatório em formato texto para o corpo do e-mail
            const textReport = generateTextReport(incQueue, incCompleted, incCancelled);
            const mailtoUrl = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent("Relatório de Demandas - Marketing Check")}&body=${encodeURIComponent(textReport)}`;
            
            // 2. Abre o cliente de e-mail padrão do usuário
            window.location.href = mailtoUrl;
            
            // 3. Abre a versão visual e formatada para impressão/PDF em nova aba
            const reportHtml = generateReportHTML(incQueue, incCompleted, incCancelled, email);
            const w = window.open('', '_blank');
            if (w) {
                w.document.write(reportHtml);
                w.document.close();
            }
            
            closeReportModal();
        });
    }

    // Modal do Supabase
    const btnOpenSupabase = document.getElementById('btn-open-supabase-modal');
    if (btnOpenSupabase) {
        btnOpenSupabase.addEventListener('click', openSupabaseModal);
    }
    const supabaseForm = document.getElementById('supabase-form');
    if (supabaseForm) {
        supabaseForm.addEventListener('submit', handleSupabaseConnect);
    }
    
    // Submissão do formulário de justificativa de pausa
    const pauseForm = document.getElementById('pause-form');
    if (pauseForm) {
        pauseForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const reason = document.getElementById('pause-reason').value.trim();
            if (!reason) return;
            
            if (currentPauseTaskId) {
                const task = tasks.find(t => t.id === currentPauseTaskId);
                if (task) {
                    if (!task.pauseHistory) {
                        task.pauseHistory = [];
                    }
                    
                    const userEmail = await getCurrentUserEmail();
                    task.pauseHistory.push({
                        timestamp: new Date().toISOString(),
                        reason: reason,
                        user: userEmail
                    });
                    
                    task.status = 'pausado';
                    saveState();
                    recalculateSchedule();
                    renderAll();
                }
                closePauseModal();
            }
        });
    }
}

// Live calculation preview
function updateTimePreview() {
    const qty = parseInt(document.getElementById('quantity').value) || 0;
    const unitTime = parseFloat(document.getElementById('unit-time').value) || 0;
    const unit = document.getElementById('time-unit').value;
    
    let duration = qty * unitTime;
    if (unit === 'hour') {
        duration = duration * 60;
    }
    
    document.getElementById('task-time-preview').textContent = formatFriendlyDuration(duration);
}

// --- Queue Controls & Drag & Drop ---
function setupDragAndDrop() {
    const listContainer = document.getElementById('queue-list');
    const taskCards = listContainer.querySelectorAll('.task-card');
    
    taskCards.forEach(card => {
        card.addEventListener('dragstart', (e) => {
            card.classList.add('dragging');
            e.dataTransfer.setData('text/plain', card.dataset.id);
        });
        
        card.addEventListener('dragend', () => {
            card.classList.remove('dragging');
        });
        
        card.addEventListener('dragover', (e) => {
            e.preventDefault();
            const draggingCard = listContainer.querySelector('.dragging');
            const siblings = [...listContainer.querySelectorAll('.task-card:not(.dragging)')];
            
            let nextSibling = siblings.find(sibling => {
                const box = sibling.getBoundingClientRect();
                return e.clientY <= box.top + box.height / 2;
            });
            
            listContainer.insertBefore(draggingCard, nextSibling);
        });

        card.addEventListener('drop', () => {
            // Rebuild queue based on final HTML order
            const renderedCards = [...listContainer.querySelectorAll('.task-card')];
            const newTasksOrder = [];
            
            renderedCards.forEach(cardEl => {
                const tId = cardEl.dataset.id;
                const found = tasks.find(t => t.id === tId);
                if (found) newTasksOrder.push(found);
            });
            
            tasks = newTasksOrder;
            saveState();
            recalculateSchedule();
            renderAll();
        });
    });
}

// Accessibility buttons: move up / down
function moveTaskUp(taskId) {
    const index = tasks.findIndex(t => t.id === taskId);
    if (index > 0) {
        const temp = tasks[index];
        tasks[index] = tasks[index - 1];
        tasks[index - 1] = temp;
        saveState();
        recalculateSchedule();
        renderAll();
    }
}

function moveTaskDown(taskId) {
    const index = tasks.findIndex(t => t.id === taskId);
    if (index !== -1 && index < tasks.length - 1) {
        const temp = tasks[index];
        tasks[index] = tasks[index + 1];
        tasks[index + 1] = temp;
        saveState();
        recalculateSchedule();
        renderAll();
    }
}

// Task Status Changes
async function getCurrentUserEmail() {
    if (supabaseClient && supabaseClient.auth) {
        const { data } = await supabaseClient.auth.getUser();
        if (data && data.user) {
            return data.user.email;
        }
    }
    return 'Usuário Local';
}

let currentPauseTaskId = null;

function openPauseModal(taskId) {
    currentPauseTaskId = taskId;
    document.getElementById('pause-reason').value = '';
    document.getElementById('pause-modal').classList.add('active');
    setTimeout(() => {
        const input = document.getElementById('pause-reason');
        if (input) input.focus();
    }, 100);
}

function closePauseModal() {
    document.getElementById('pause-modal').classList.remove('active');
    currentPauseTaskId = null;
}

function setTaskStatus(taskId, status) {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    if (status === 'iniciado') {
        task.status = 'iniciado';
        task.startedAt = new Date().toISOString();
        saveState();
        recalculateSchedule();
        renderAll();
    } else if (status === 'pausado') {
        openPauseModal(taskId);
    } else if (status === 'fila') {
        task.status = 'fila';
        saveState();
        recalculateSchedule();
        renderAll();
    }
}

let globalDeleteCallback = null;

function showCustomDeleteModal(title, text, name, detailsLabel, detailsValue, warningText, onConfirmCallback) {
    const modalHeaderH3 = document.querySelector('#delete-confirm-modal .modal-header h3');
    if (modalHeaderH3) {
        modalHeaderH3.innerHTML = `
            <svg viewBox="0 0 24 24" class="icon" fill="none" stroke="currentColor" stroke-width="2" style="width: 20px; height: 20px;">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
            ${title}
        `;
    }
    
    document.getElementById('delete-confirm-modal-text').textContent = text;
    document.getElementById('delete-confirm-task-name').textContent = name;
    
    const labelEl = document.getElementById('delete-confirm-task-requestor-label');
    if (labelEl) labelEl.textContent = detailsLabel;
    
    document.getElementById('delete-confirm-task-requestor').textContent = detailsValue;
    document.getElementById('delete-confirm-modal-warning').textContent = warningText;
    
    globalDeleteCallback = onConfirmCallback;
    document.getElementById('delete-confirm-modal').classList.add('active');
}

function closeDeleteConfirmModal() {
    document.getElementById('delete-confirm-modal').classList.remove('active');
    globalDeleteCallback = null;
}

function openDeleteConfirmModal(taskId) {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    
    showCustomDeleteModal(
        'Excluir Demanda',
        'Deseja realmente excluir esta atividade permanentemente?',
        task.name + ' (' + task.material + ')',
        'Solicitante:',
        task.requestor || '---',
        'Esta ação não poderá ser desfeita e os dados serão apagados na nuvem.',
        () => {
            deleteTask(taskId);
        }
    );
}

function deleteTask(taskId) {
    tasks = tasks.filter(t => t.id !== taskId);
    saveState();
    recalculateSchedule();
    renderAll();
}

let currentDetailsTaskId = null;

function openDetailsModal(taskId) {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    
    currentDetailsTaskId = taskId;
    
    // Preenche as informações básicas
    document.getElementById('detail-name').textContent = task.name;
    document.getElementById('detail-material').textContent = task.material;
    document.getElementById('detail-requestor').textContent = task.requestor || '---';
    document.getElementById('detail-qty').textContent = task.qty;
    document.getElementById('detail-duration').textContent = formatFriendlyDuration(task.duration);
    
    // Status formatado
    let statusText = 'Não Iniciado';
    if (task.status === 'iniciado') {
        statusText = task.isDelayed ? 'Iniciado (Atrasado)' : 'Iniciando';
    } else if (task.status === 'pausado') {
        statusText = 'Pausado';
    }
    document.getElementById('detail-status').textContent = statusText;
    
    // Datas
    document.getElementById('detail-requested-at').textContent = task.requestedAt ? formatFriendlyDateTime(task.requestedAt) : '---';
    document.getElementById('detail-planned-start').textContent = task.plannedStart ? formatFriendlyDateTime(task.plannedStart) : '---';
    document.getElementById('detail-planned-end').textContent = task.plannedEnd ? formatFriendlyDateTime(task.plannedEnd) : '---';
    
    // Prazo Fixo
    document.getElementById('detail-fixed-deadline').textContent = task.fixedDeadline ? formatFriendlyDateTime(task.fixedDeadline) : 'Sem prazo fixo definido';
    
    // Descrição
    document.getElementById('detail-description').textContent = task.description || 'Nenhuma descrição adicionada.';
    
    // Botão de fixar/desafixar prazo
    const container = document.getElementById('detail-fix-deadline-container');
    container.innerHTML = '';
    
    if (task.fixedDeadline) {
        // Se já tem prazo fixo, exibe botão para desafixar
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-secondary';
        btn.style.borderColor = '#ef4444';
        btn.style.color = '#ef4444';
        btn.style.fontWeight = 'bold';
        btn.style.padding = '8px 12px';
        btn.style.fontSize = '0.85rem';
        btn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width: 14px; height: 14px; margin-right: 4px;">
                <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
            </svg>
            Desafixar Prazo
        `;
        btn.onclick = () => {
            unfixDeadline(task.id);
            openDetailsModal(task.id); // Recarrega a exibição
        };
        container.appendChild(btn);
    } else {
        // Se não tem prazo fixo, exibe botão para fixar o prazo calculado
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-secondary';
        btn.style.borderColor = '#fbbf24';
        btn.style.color = '#fbbf24';
        btn.style.fontWeight = 'bold';
        btn.style.padding = '8px 12px';
        btn.style.fontSize = '0.85rem';
        btn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width: 14px; height: 14px; margin-right: 4px;">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
            </svg>
            Fixar Prazo do Sistema
        `;
        btn.onclick = () => {
            if (task.plannedEnd) {
                fixSystemDeadline(task.id);
                openDetailsModal(task.id); // Recarrega a exibição
            } else {
                alert('Não há data de entrega calculada pelo sistema para fixar.');
            }
        };
        container.appendChild(btn);
    }
    // Renderiza o Histórico de Pausas
    const historyContainer = document.getElementById('detail-pause-history');
    if (historyContainer) {
        historyContainer.innerHTML = '';
        if (task.pauseHistory && task.pauseHistory.length > 0) {
            task.pauseHistory.forEach(item => {
                const entry = document.createElement('div');
                entry.style.cssText = `
                    display: flex;
                    flex-direction: column;
                    gap: 3px;
                    border-bottom: 1px solid var(--border-color);
                    padding-bottom: 6px;
                `;
                
                const timeStr = formatFriendlyDateTime(item.timestamp);
                
                entry.innerHTML = `
                    <div style="display: flex; justify-content: space-between; font-size: 0.75rem; color: var(--text-muted);">
                        <span>Pausado em: <strong>${timeStr}</strong></span>
                        <span>Por: <strong>${item.user || 'Local'}</strong></span>
                    </div>
                    <div style="font-size: 0.8rem; color: var(--text-primary); font-weight: 500;">
                        Motivo: <span style="font-weight: normal; color: var(--text-secondary);">${item.reason}</span>
                    </div>
                `;
                historyContainer.appendChild(entry);
            });
            if (historyContainer.lastElementChild) {
                historyContainer.lastElementChild.style.borderBottom = 'none';
                historyContainer.lastElementChild.style.paddingBottom = '0';
            }
        } else {
            historyContainer.innerHTML = `<span style="font-style: italic; color: var(--text-muted); font-size: 0.75rem;">Nenhuma pausa registrada nesta atividade.</span>`;
        }
    }
    
    document.getElementById('details-modal').classList.add('active');
}

function closeDetailsModal() {
    document.getElementById('details-modal').classList.remove('active');
    currentDetailsTaskId = null;
}

function fixSystemDeadline(taskId) {
    const task = tasks.find(t => t.id === taskId);
    if (!task || !task.plannedEnd) return;
    
    task.fixedDeadline = task.plannedEnd;
    saveState();
    recalculateSchedule();
    renderAll();
}

function unfixDeadline(taskId) {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    
    task.fixedDeadline = null;
    saveState();
    recalculateSchedule();
    renderAll();
}

// --- Task Creation Modal flow ---
function openTaskModal() {
    const modal = document.getElementById('task-modal');
    modal.classList.add('active');
    
    // Reseta os campos para o padrão inicial limpo
    document.getElementById('task-name').value = '';
    document.getElementById('material-name').value = '';
    document.getElementById('task-requestor').value = '';
    document.getElementById('quantity').value = 1;
    document.getElementById('unit-time').value = 5;
    document.getElementById('time-unit').value = 'min';
    document.getElementById('fixed-deadline').value = '';
    document.getElementById('task-description').value = '';
    
    // Preenche a data de solicitação com o horário de agora formatado para datetime-local
    document.getElementById('request-date').value = formatDateTimeLocal(new Date());
    
    updateTimePreview();
    
    document.getElementById('task-name').focus();
}

function closeTaskModal() {
    document.getElementById('task-modal').classList.remove('active');
}

// --- Overtime Modal flow ---
function openOvertimeModal() {
    const modal = document.getElementById('overtime-modal');
    modal.classList.add('active');
    
    const pad = (n) => String(n).padStart(2, '0');
    const now = new Date();
    document.getElementById('overtime-date').value = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    document.getElementById('overtime-start').value = '17:00';
    document.getElementById('overtime-end').value = '19:00';
}

function closeOvertimeModal() {
    document.getElementById('overtime-modal').classList.remove('active');
}

function renderOvertimes() {
    const container = document.getElementById('overtime-list');
    if (!container) return;
    container.innerHTML = '';
    
    if (!config.overtimes) {
        config.overtimes = [];
    }
    
    if (config.overtimes.length === 0) {
        container.innerHTML = `<span style="font-size: 0.75rem; color: var(--text-muted); font-style: italic; text-align: center;">Nenhuma hora extra cadastrada</span>`;
        return;
    }
    
    config.overtimes.forEach(ot => {
        const item = document.createElement('div');
        item.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            padding: 0.5rem 0.75rem;
            font-size: 0.75rem;
        `;
        
        const dateParts = ot.date.split('-');
        const localDate = new Date(dateParts[0], dateParts[1] - 1, dateParts[2]);
        const weekdayStr = localDate.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
        const friendlyDate = `${dateParts[2]}/${dateParts[1]} (${weekdayStr})`;
        
        item.innerHTML = `
            <div style="display: flex; flex-direction: column; gap: 2px;">
                <span style="font-weight: 700; color: #28B9DA;">${friendlyDate}</span>
                <span style="color: var(--text-secondary);">${ot.startTime} às ${ot.endTime}</span>
            </div>
            <button type="button" class="btn-delete-ot" style="background: transparent; border: none; color: var(--text-muted); cursor: pointer; display: flex; align-items: center; padding: 2px;" title="Remover Hora Extra">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width: 14px; height: 14px;">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
            </button>
        `;
        
        item.querySelector('.btn-delete-ot').addEventListener('click', () => {
            removeOvertime(ot.id);
        });
        
        container.appendChild(item);
    });
}

function removeOvertime(id) {
    const ot = config.overtimes.find(item => item.id === id);
    if (!ot) return;
    
    const friendlyDate = formatFriendlyDate(ot.date);
    showCustomDeleteModal(
        'Excluir Hora Extra',
        'Deseja realmente remover esta hora extra da programação?',
        friendlyDate,
        'Horário:',
        `${ot.startTime} às ${ot.endTime}`,
        'A exclusão recalculará os prazos de todas as demandas na fila.',
        () => {
            config.overtimes = config.overtimes.filter(item => item.id !== id);
            saveState();
            recalculateSchedule();
            renderAll();
        }
    );
}

// --- Absence/Holiday Modal flow ---
function openAbsenceModal() {
    const modal = document.getElementById('absence-modal');
    modal.classList.add('active');
    
    const pad = (n) => String(n).padStart(2, '0');
    const now = new Date();
    document.getElementById('absence-date').value = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    
    // Set default values matching normal shift start/end
    const absenceStart = document.getElementById('absence-start');
    const absenceEnd = document.getElementById('absence-end');
    const absenceAllDay = document.getElementById('absence-all-day');
    
    absenceStart.value = config.shiftStart || '08:00';
    absenceEnd.value = config.shiftEnd || '16:30';
    
    if (absenceAllDay) {
        absenceAllDay.checked = false;
    }
    absenceStart.disabled = false;
    absenceEnd.disabled = false;
}

function closeAbsenceModal() {
    document.getElementById('absence-modal').classList.remove('active');
}

function renderAbsences() {
    const container = document.getElementById('absence-list');
    if (!container) return;
    container.innerHTML = '';
    
    if (!config.absences) {
        config.absences = [];
    }
    
    if (config.absences.length === 0) {
        container.innerHTML = `<span style="font-size: 0.75rem; color: var(--text-muted); font-style: italic; text-align: center;">Nenhuma falta cadastrada</span>`;
        return;
    }
    
    config.absences.forEach(abs => {
        const item = document.createElement('div');
        item.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            padding: 0.5rem 0.75rem;
            font-size: 0.75rem;
        `;
        
        const dateParts = abs.date.split('-');
        const localDate = new Date(dateParts[0], dateParts[1] - 1, dateParts[2]);
        const weekdayStr = localDate.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
        const friendlyDate = `${dateParts[2]}/${dateParts[1]} (${weekdayStr})`;
        
        item.innerHTML = `
            <div style="display: flex; flex-direction: column; gap: 2px;">
                <span style="font-weight: 700; color: #f43f5e;">${friendlyDate}</span>
                <span style="color: var(--text-secondary);">${abs.startTime} às ${abs.endTime}</span>
            </div>
            <button type="button" class="btn-delete-abs" style="background: transparent; border: none; color: var(--text-muted); cursor: pointer; display: flex; align-items: center; padding: 2px;" title="Remover Falta/Feriado">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width: 14px; height: 14px;">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
            </button>
        `;
        
        item.querySelector('.btn-delete-abs').addEventListener('click', () => {
            removeAbsence(abs.id);
        });
        
        container.appendChild(item);
    });
}

function removeAbsence(id) {
    const abs = config.absences.find(item => item.id === id);
    if (!abs) return;
    
    const friendlyDate = formatFriendlyDate(abs.date);
    showCustomDeleteModal(
        'Excluir Falta / Feriado',
        'Deseja realmente remover este registro de falta ou feriado?',
        friendlyDate,
        'Horário:',
        `${abs.startTime} às ${abs.endTime}`,
        'A exclusão recalculará os prazos de todas as demandas na fila.',
        () => {
            config.absences = config.absences.filter(item => item.id !== id);
            saveState();
            recalculateSchedule();
            renderAll();
        }
    );
}

// --- Cancellation flow ---
function openCancelModal(taskId) {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    
    activeModalTaskId = taskId;
    document.getElementById('cancel-task-info').textContent = `${task.name} - ${task.material}`;
    document.getElementById('cancel-reason').value = '';
    
    const modal = document.getElementById('cancel-modal');
    modal.classList.add('active');
    document.getElementById('cancel-reason').focus();
}

function closeCancelModal() {
    document.getElementById('cancel-modal').classList.remove('active');
    activeModalTaskId = null;
}

function confirmCancellation() {
    const reason = document.getElementById('cancel-reason').value.trim();
    if (!reason) {
        alert('Por favor, informe o motivo do cancelamento.');
        return;
    }
    
    const taskIndex = tasks.findIndex(t => t.id === activeModalTaskId);
    if (taskIndex !== -1) {
        const removed = tasks.splice(taskIndex, 1)[0];
        
        // Add cancel details
        removed.cancelledAt = Date.now();
        removed.reason = reason;
        
        cancelled.push(removed);
        saveState();
        closeCancelModal();
        recalculateSchedule();
        renderAll();
    }
}

// --- Completion flow ---
function openCompleteModal(taskId) {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    
    activeModalTaskId = taskId;
    document.getElementById('complete-task-info').textContent = `${task.name} - ${task.material}`;
    
    // Preset actualEnd to now
    const now = new Date();
    document.getElementById('actual-completion-time').value = formatDateTimeLocal(now);
    
    const modal = document.getElementById('complete-modal');
    modal.classList.add('active');
}

function closeCompleteModal() {
    document.getElementById('complete-modal').classList.remove('active');
    activeModalTaskId = null;
}

function confirmCompletion() {
    const actualTimeVal = document.getElementById('actual-completion-time').value;
    if (!actualTimeVal) {
        alert('Por favor, selecione a data e horário de conclusão.');
        return;
    }
    
    const taskIndex = tasks.findIndex(t => t.id === activeModalTaskId);
    if (taskIndex !== -1) {
        const task = tasks.splice(taskIndex, 1)[0];
        
        const actualEnd = new Date(actualTimeVal);
        const plannedEnd = new Date(task.plannedEnd);
        
        // Calculate deviation in minutes (actual - planned)
        // Positive is late, negative is early
        let deviation = 0;
        if (task.plannedEnd) {
            deviation = Math.round((actualEnd - plannedEnd) / 60000);
        }
        
        task.actualEnd = actualEnd.toISOString();
        task.completedAt = Date.now();
        task.deviation = deviation;
        
        completed.push(task);
        saveState();
        closeCompleteModal();
        
        // Recalculate schedule (the engine will seed start time using this actualEnd if it is the latest completed date)
        recalculateSchedule();
        renderAll();
    }
}

function deleteCompletedItem(index) {
    const task = completed[index];
    if (!task) return;
    
    showCustomDeleteModal(
        'Excluir do Histórico',
        'Deseja realmente excluir este item do histórico permanentemente?',
        task.name + ' (' + task.material + ')',
        'Concluído em:',
        task.actualEnd ? formatFriendlyDateTime(new Date(task.actualEnd)) : '---',
        'Esta ação removerá o registro do histórico de forma definitiva.',
        () => {
            completed.splice(index, 1);
            saveState();
            renderAll();
        }
    );
}

function deleteCancelledItem(index) {
    const task = cancelled[index];
    if (!task) return;
    
    showCustomDeleteModal(
        'Excluir do Histórico',
        'Deseja realmente excluir este item do histórico permanentemente?',
        task.name + ' (' + task.material + ')',
        'Cancelado em:',
        task.cancelledAt ? formatFriendlyDateTime(new Date(task.cancelledAt)) : '---',
        'Esta ação removerá o registro do histórico de forma definitiva.',
        () => {
            cancelled.splice(index, 1);
            saveState();
            renderAll();
        }
    );
}

// --- Report Modal flow ---
function openReportModal() {
    document.getElementById('report-modal').classList.add('active');
    document.getElementById('report-email').value = '';
    document.getElementById('rep-queue').checked = true;
    document.getElementById('rep-completed').checked = true;
    document.getElementById('rep-cancelled').checked = true;
}

function closeReportModal() {
    document.getElementById('report-modal').classList.remove('active');
}

function generateReportHTML(includeQueue, includeCompleted, includeCancelled, destinationEmail) {
    let html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Relatório de Demandas - Marketing Check</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
    <style>
        body {
            font-family: 'Inter', sans-serif;
            background-color: #ffffff;
            color: #1e293b;
            margin: 0;
            padding: 40px;
        }
        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 2px solid #e2e8f0;
            padding-bottom: 20px;
            margin-bottom: 30px;
        }
        .logo-container {
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .logo-text {
            font-size: 24px;
            font-weight: 800;
            color: #2b344a;
        }
        .logo-text span {
            color: #28B9DA;
        }
        .report-title {
            font-size: 20px;
            font-weight: 700;
            color: #64748b;
            text-transform: uppercase;
            letter-spacing: 1px;
        }
        .section-title {
            font-size: 16px;
            font-weight: 700;
            color: #1e293b;
            margin-top: 40px;
            margin-bottom: 15px;
            border-left: 4px solid #8ebd35;
            padding-left: 10px;
            text-transform: uppercase;
        }
        table {
            width: 100%;
            border-collapse: separate;
            border-spacing: 0 8px;
            margin-bottom: 30px;
        }
        th {
            padding: 12px 16px;
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: white;
            font-weight: 700;
            text-align: left;
        }
        th.green-header {
            background-color: #8ebd35;
        }
        th.blue-header {
            background-color: #2b344a;
        }
        th.center, td.center {
            text-align: center;
        }
        td {
            padding: 16px;
            background-color: #f8fafc;
            border-top: 1px solid #e2e8f0;
            border-bottom: 1px solid #e2e8f0;
            font-size: 13px;
            color: #334155;
            vertical-align: middle;
        }
        td:first-child {
            border-left: 1px solid #e2e8f0;
            border-radius: 6px 0 0 6px;
            font-weight: bold;
            color: #64748b;
            width: 60px;
        }
        td:last-child {
            border-right: 1px solid #e2e8f0;
            border-radius: 0 6px 6px 0;
        }
        .item-title {
            font-weight: 700;
            color: #1e293b;
            font-size: 14px;
            margin-bottom: 4px;
        }
        .item-subtitle {
            font-size: 11px;
            color: #64748b;
            line-height: 1.4;
        }
        .meta-text {
            font-weight: 600;
            color: #334155;
        }
        .no-data {
            text-align: center;
            color: #94a3b8;
            font-style: italic;
            padding: 30px;
            background: #f8fafc;
            border: 1px dashed #cbd5e1;
            border-radius: 6px;
        }
        @media print {
            body {
                padding: 0;
            }
            .no-print {
                display: none;
            }
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="logo-container">
            <svg viewBox="0 0 24 24" fill="none" stroke="#28B9DA" stroke-width="3" style="width: 28px; height: 28px;">
                <polyline points="20 6 9 17 4 12"/>
            </svg>
            <div class="logo-text"><span>Marketing</span> Check</div>
        </div>
        <div class="report-title">Relatório de Demandas</div>
    </div>
    
    <div class="no-print" style="margin-bottom: 30px; background: #e0f2fe; border: 1px solid #bae6fd; padding: 15px; border-radius: 8px; display: flex; justify-content: space-between; align-items: center; gap: 1rem;">
        <span style="font-size: 13px; font-weight: 600; color: #0369a1; line-height: 1.4;">
            Seu cliente de e-mail foi aberto com o rascunho de texto do relatório. Para enviar esta versão visual formatada, clique em imprimir e salve como PDF para anexar no e-mail destinado a: <strong>${destinationEmail}</strong>.
        </span>
        <button onclick="window.print()" style="background: #28B9DA; color: #111; border: none; padding: 8px 16px; border-radius: 6px; font-weight: bold; cursor: pointer; white-space: nowrap;">Imprimir / Salvar PDF</button>
    </div>
`;

    const pad = (n) => String(n).padStart(2, '0');

    if (includeQueue) {
        html += `<div class="section-title">Fila de Atividades Ativas</div>`;
        if (tasks.length === 0) {
            html += `<div class="no-data">Nenhuma atividade ativa na fila</div>`;
        } else {
            html += `
            <table>
                <thead>
                    <tr>
                        <th class="green-header center" style="width: 50px;">Nº</th>
                        <th class="green-header">Descrição da Demanda</th>
                        <th class="blue-header">Solicitante</th>
                        <th class="blue-header center" style="width: 80px;">Qtd</th>
                        <th class="blue-header center" style="width: 100px;">Duração</th>
                        <th class="blue-header">Período Planejado</th>
                    </tr>
                </thead>
                <tbody>
            `;
            tasks.forEach((task, idx) => {
                const sub = `Material: <strong>${task.material}</strong>\${task.description ? ' | Obs: ' + task.description : ''}`;
                const period = `\${formatFriendlyDateTime(task.plannedStart)} às \${formatFriendlyDateTime(task.plannedEnd)}`;
                html += `
                    <tr>
                        <td class="center">\${pad(idx + 1)}</td>
                        <td>
                            <div class="item-title">\${task.name}</div>
                            <div class="item-subtitle">\${sub}</div>
                        </td>
                        <td class="meta-text">\${task.requestor || '---'}</td>
                        <td class="center meta-text">\${task.qty}</td>
                        <td class="center meta-text">\${formatFriendlyDuration(task.duration)}</td>
                        <td class="meta-text" style="font-size: 12px;">\${period}</td>
                    </tr>
                `;
            });
            html += `</tbody></table>`;
        }
    }

    if (includeCompleted) {
        html += `<div class="section-title">Histórico de Concluídos</div>`;
        if (completed.length === 0) {
            html += `<div class="no-data">Nenhuma atividade concluída no histórico</div>`;
        } else {
            html += `
            <table>
                <thead>
                    <tr>
                        <th class="green-header center" style="width: 50px;">Nº</th>
                        <th class="green-header">Descrição da Demanda</th>
                        <th class="blue-header">Solicitante</th>
                        <th class="blue-header center" style="width: 80px;">Qtd</th>
                        <th class="blue-header">Data de Conclusão</th>
                        <th class="blue-header center" style="width: 100px;">Desvio</th>
                    </tr>
                </thead>
                <tbody>
            `;
            completed.forEach((task, idx) => {
                const sub = `Material: <strong>${task.material}</strong>\${task.description ? ' | Obs: ' + task.description : ''}`;
                const dev = task.deviation !== undefined ? `\${task.deviation > 0 ? '+' : ''}\${task.deviation} min` : '---';
                const devColor = task.deviation > 0 ? '#f43f5e' : (task.deviation < 0 ? '#10b981' : '#334155');
                html += `
                    <tr>
                        <td class="center">\${pad(idx + 1)}</td>
                        <td>
                            <div class="item-title">\${task.name}</div>
                            <div class="item-subtitle">\${sub}</div>
                        </td>
                        <td class="meta-text">\${task.requestor || '---'}</td>
                        <td class="center meta-text">\${task.qty}</td>
                        <td class="meta-text">\${task.actualEnd ? formatFriendlyDateTime(task.actualEnd) : '---'}</td>
                        <td class="center meta-text" style="color: \${devColor};">\${dev}</td>
                    </tr>
                `;
            });
            html += `</tbody></table>`;
        }
    }

    if (includeCancelled) {
        html += `<div class="section-title">Histórico de Cancelados</div>`;
        if (cancelled.length === 0) {
            html += `<div class="no-data">Nenhuma atividade cancelada no histórico</div>`;
        } else {
            html += `
            <table>
                <thead>
                    <tr>
                        <th class="green-header center" style="width: 50px;">Nº</th>
                        <th class="green-header">Descrição da Demanda</th>
                        <th class="blue-header">Solicitante</th>
                        <th class="blue-header center" style="width: 80px;">Qtd</th>
                        <th class="blue-header">Data de Cancelamento</th>
                        <th class="blue-header">Motivo do Cancelamento</th>
                    </tr>
                </thead>
                <tbody>
            `;
            cancelled.forEach((task, idx) => {
                const sub = `Material: <strong>${task.material}</strong>\${task.description ? ' | Obs: ' + task.description : ''}`;
                html += `
                    <tr>
                        <td class="center">\${pad(idx + 1)}</td>
                        <td>
                            <div class="item-title">\${task.name}</div>
                            <div class="item-subtitle">\${sub}</div>
                        </td>
                        <td class="meta-text">\${task.requestor || '---'}</td>
                        <td class="center meta-text">\${task.qty}</td>
                        <td class="meta-text">\${task.cancelledAt ? formatFriendlyDateTime(task.cancelledAt) : '---'}</td>
                        <td class="meta-text" style="font-style: italic; color: #64748b;">\${task.cancelReason || 'Não informado'}</td>
                    </tr>
                `;
            });
            html += `</tbody></table>`;
        }
    }

    html += `
    <div style="margin-top: 50px; text-align: center; font-size: 11px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 20px;">
        Relatório gerado automaticamente em \${formatFriendlyDateTime(new Date().toISOString())} por Marketing Check
    </div>
</body>
</html>
`;
    return html;
}

// --- UI Rendering ---
function renderAll() {
    renderKPIs();
    renderQueue();
    renderGantt();
    renderCompletedHistory();
    renderCancelledHistory();
}

function renderKPIs() {
    // 1. Final Delivery
    const activeTasks = tasks.filter(t => t.status !== 'pausado');
    if (activeTasks.length > 0) {
        // Last active task planned end date
        let maxEnd = null;
        activeTasks.forEach(t => {
            if (t.plannedEnd) {
                const ed = new Date(t.plannedEnd);
                if (!maxEnd || ed > maxEnd) maxEnd = ed;
            }
        });
        document.getElementById('kpi-final-delivery').textContent = maxEnd ? formatFriendlyDateTime(maxEnd) : 'Sem entregas';
    } else {
        document.getElementById('kpi-final-delivery').textContent = 'Sem entregas';
    }
    
    // 2. Active Backlog Time
    let totalMins = 0;
    tasks.forEach(t => {
        if (t.status !== 'pausado') totalMins += t.duration;
    });
    document.getElementById('kpi-total-duration').textContent = formatFriendlyDuration(totalMins);
    
    // 3. Count Todo (Fila)
    const todoCount = tasks.filter(t => t.status === 'fila').length;
    document.getElementById('kpi-todo-count').textContent = `${todoCount} Trabalho${todoCount === 1 ? '' : 's'}`;
    
    // 4. Count In Progress (Iniciado)
    const progressCount = tasks.filter(t => t.status === 'iniciado').length;
    document.getElementById('kpi-inprogress-count').textContent = `${progressCount} Trabalho${progressCount === 1 ? '' : 's'}`;
    
    // 5. Count Paused (Pausado)
    const pausedCount = tasks.filter(t => t.status === 'pausado').length;
    document.getElementById('kpi-paused-count').textContent = `${pausedCount} Trabalho${pausedCount === 1 ? '' : 's'}`;
}

function renderQueue() {
    const listContainer = document.getElementById('queue-list');
    const emptyState = document.getElementById('queue-empty');
    
    listContainer.innerHTML = '';
    
    if (tasks.length === 0) {
        emptyState.style.display = 'flex';
        return;
    }
    emptyState.style.display = 'none';
    
    tasks.forEach((task, idx) => {
        const card = document.createElement('div');
        card.className = `task-card`;
        card.dataset.id = task.id;
        card.setAttribute('draggable', 'true');
        
        card.addEventListener('dblclick', (e) => {
            if (e.target.closest('.task-controls')) return;
            openDetailsModal(task.id);
        });
        
        // Status classes for borders/backgrounds
        if (task.status === 'pausado') {
            card.classList.add('status-paused-card');
        } else if (task.status === 'iniciado') {
            card.classList.add('status-started-card');
            if (task.isDelayed) {
                card.classList.add('status-delayed-card');
            }
        }
        
        // Status Pill HTML
        let statusPillHtml = '';
        if (task.status === 'pausado') {
            statusPillHtml = `<span class="status-pill pausado">Pausado</span>`;
        } else if (task.status === 'iniciado') {
            if (task.isDelayed) {
                statusPillHtml = `<span class="status-pill atrasado">Atrasado</span>`;
            } else {
                statusPillHtml = `<span class="status-pill iniciado">Iniciando</span>`;
            }
        } else {
            statusPillHtml = `<span class="status-pill fila">Não Iniciado</span>`;
        }

        // Action controls active states
        const isFila = task.status === 'fila';
        const isInit = task.status === 'iniciado';
        const isPaused = task.status === 'pausado';

        // Cria o elemento visual para prazo de entrega fixo
        let fixedDeadlineHtml = '';
        if (task.fixedDeadline) {
            const isLate = task.missesDeadline;
            const color = isLate ? '#f43f5e' : '#fbbf24';
            const bg = isLate ? 'rgba(244, 63, 94, 0.1)' : 'rgba(245, 158, 11, 0.1)';
            const border = isLate ? '1px solid rgba(244, 63, 94, 0.2)' : '1px solid rgba(245, 158, 11, 0.2)';
            const text = isLate ? 'Atraso Prazo!' : 'Prazo Fixo';
            
            fixedDeadlineHtml = `
                <span class="deadline-pill" style="color: ${color}; background: ${bg}; border: ${border}; padding: 2px 6px; border-radius: 4px; font-weight: 600; display: inline-flex; align-items: center; gap: 4px;" title="Prazo limite: ${formatFriendlyDateTime(task.fixedDeadline)}">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width: 10px; height: 10px;">
                        <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                    </svg>
                    ${text}: ${formatFriendlyDateTime(task.fixedDeadline)}
                </span>
            `;
            
            // Adiciona classe de alerta se a tarefa estiver atrasada em relação ao seu prazo fixo
            if (isLate) {
                card.classList.add('status-delayed-card');
            }
        }

            const descHtml = task.description 
                ? `<div class="task-desc" style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 0.5rem; padding: 4px 8px; background: rgba(255, 255, 255, 0.02); border-left: 2px solid #3b82f6; border-radius: 4px; line-height: 1.4; word-break: break-word;">${task.description}</div>` 
                : '';

            card.innerHTML = `
                <div class="task-drag-handle" title="Arraste para reordenar">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/>
                        <circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/>
                    </svg>
                </div>
                
                <div class="task-info-block">
                    <div class="task-title" title="${task.name} (${task.material})">${task.name}</div>
                    <div class="task-request-date" style="font-size: 0.75rem; color: var(--text-muted); margin-top: 2px; font-weight: 500;">
                        Solicitado em: ${task.requestedAt ? formatFriendlyDateTime(task.requestedAt) : '---'}
                    </div>
                    <div class="task-meta" style="margin-top: 6px;">
                        <span>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                                <line x1="9" y1="3" x2="9" y2="21"/>
                            </svg>
                            ${task.material}
                        </span>
                        <span>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 12px; height: 12px;">
                                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                                <circle cx="12" cy="7" r="4"/>
                            </svg>
                            ${task.requestor || '---'}
                        </span>
                        <span>Qtd: ${task.qty}</span>
                        <span>Prazo: ${formatFriendlyDuration(task.duration)}</span>
                        ${statusPillHtml}
                        ${fixedDeadlineHtml}
                    </div>
                    ${descHtml}
                </div>
            
            <div class="task-time-block">
                <div class="task-date-label">Entrega Calculada</div>
                <div class="task-date-value">${task.plannedEnd ? formatFriendlyDateTime(task.plannedEnd) : '---'}</div>
                <div class="task-date-start">Início: ${task.plannedStart ? formatFriendlyDateTime(task.plannedStart) : '---'}</div>
            </div>
            
            <div class="task-controls">
                <button class="ctrl-btn ${isFila ? 'active-fila' : ''}" onclick="setTaskStatus('${task.id}', 'fila')" title="Definir como Não Iniciado">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10"/>
                        <line x1="8" y1="12" x2="16" y2="12"/>
                    </svg>
                </button>
                <button class="ctrl-btn ${isInit ? 'active-iniciar' : ''}" onclick="setTaskStatus('${task.id}', 'iniciado')" title="Iniciar Trabalho">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polygon points="5 3 19 12 5 21 5 3"/>
                    </svg>
                </button>
                <button class="ctrl-btn ${isPaused ? 'active-pausar' : ''}" onclick="setTaskStatus('${task.id}', 'pausado')" title="Pausar Trabalho">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>
                    </svg>
                </button>
                <button class="ctrl-btn btn-concluir" onclick="openCompleteModal('${task.id}')" title="Marcar como Concluído">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="20 6 9 17 4 12"/>
                    </svg>
                </button>
                <button class="ctrl-btn btn-cancelar" onclick="openCancelModal('${task.id}')" title="Cancelar Demanda">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                </button>
                <button class="ctrl-btn btn-delete" onclick="openDeleteConfirmModal('${task.id}')" title="Excluir Demanda">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="3 6 5 6 21 6"/>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                    </svg>
                </button>
            </div>
        `;
        
        listContainer.appendChild(card);
    });
    
    setupDragAndDrop();
}

function renderGantt() {
    const ganttContainer = document.getElementById('gantt-chart-container');
    const ganttEmpty = document.getElementById('gantt-empty');
    const ganttWrapper = document.getElementById('gantt-wrapper');
    const ganttHeader = document.getElementById('gantt-header-dates');
    const ganttRows = document.getElementById('gantt-rows-container');
    
    const activeTasks = tasks.filter(t => t.plannedStart && t.plannedEnd);
    
    if (activeTasks.length === 0) {
        ganttEmpty.style.display = 'flex';
        ganttWrapper.style.display = 'none';
        return;
    }
    
    ganttEmpty.style.display = 'none';
    ganttWrapper.style.display = 'flex';
    
    // Find absolute boundaries of the timeline range
    let minDate = new Date(config.prodStart);
    let maxDate = new Date(config.prodStart);
    
    activeTasks.forEach(t => {
        const start = new Date(t.plannedStart);
        const end = new Date(t.plannedEnd);
        if (start < minDate) minDate = start;
        if (end > maxDate) maxDate = end;
    });

    // Make sure we show at least 1 day scope, pad maxDate a little bit
    if (maxDate - minDate < 4 * 60 * 60 * 1000) {
        maxDate = new Date(minDate.getTime() + 12 * 60 * 60 * 1000);
    } else {
        // Pad by 2 hours
        maxDate = new Date(maxDate.getTime() + 2 * 60 * 60 * 1000);
    }
    
    const timelineDuration = maxDate - minDate;

    // Render Headers (Day marks)
    ganttHeader.innerHTML = '';
    // Draw day columns
    const totalDays = Math.ceil(timelineDuration / (24 * 60 * 60 * 1000)) || 1;
    const daysToShow = Math.max(totalDays, 3); // minimum 3 columns for visualization width
    
    const dayWidthPercent = 100 / daysToShow;
    
    // Generate date markers
    let currentMarkerDate = new Date(minDate);
    for (let i = 0; i < daysToShow; i++) {
        const dayCol = document.createElement('div');
        dayCol.className = 'gantt-time-col';
        dayCol.style.width = `${dayWidthPercent}%`;
        
        const dateStr = currentMarkerDate.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
        const weekdayStr = currentMarkerDate.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
        dayCol.textContent = `${weekdayStr} (${dateStr})`;
        
        ganttHeader.appendChild(dayCol);
        currentMarkerDate.setDate(currentMarkerDate.getDate() + 1);
    }

    // Render Rows
    ganttRows.innerHTML = '';
    
    activeTasks.forEach(task => {
        const row = document.createElement('div');
        row.className = 'gantt-row';
        
        const start = new Date(task.plannedStart);
        const end = new Date(task.plannedEnd);
        
        // Calculate percentages
        const left = ((start - minDate) / (daysToShow * 24 * 60 * 60 * 1000)) * 100;
        const width = ((end - start) / (daysToShow * 24 * 60 * 60 * 1000)) * 100;
        
        // Clamp to positive boundary
        const leftClamped = Math.max(0, Math.min(left, 99));
        const widthClamped = Math.max(1.5, Math.min(width, 100 - leftClamped)); // Minimum 1.5% so it's visible
        
        // Bar color status class
        let barClass = 'fila';
        if (task.status === 'iniciado') {
            barClass = task.isDelayed ? 'atrasado' : 'iniciado';
        } else if (task.status === 'pausado') {
            barClass = 'pausado';
        }
        
        // Adiciona classe de alerta no Gantt se estourar o prazo
        if (task.missesDeadline) {
            barClass += ' misses-deadline';
        }

        row.innerHTML = `
            <div class="gantt-row-label" title="${task.name} - ${task.material}">${task.name}</div>
            <div class="gantt-bar-container">
                <div class="gantt-bar ${barClass}" style="left: ${leftClamped}%; width: ${widthClamped}%" title="${task.name}: ${formatFriendlyDateTime(start)} até ${formatFriendlyDateTime(end)}">
                    <span class="gantt-bar-label">${task.material} (${task.qty})</span>
                </div>
            </div>
        `;
        
        ganttRows.appendChild(row);
    });
}

function renderCompletedHistory() {
    const list = document.getElementById('completed-list');
    const emptyState = document.getElementById('completed-empty');
    
    list.innerHTML = '';
    
    if (completed.length === 0) {
        emptyState.style.display = 'block';
        return;
    }
    emptyState.style.display = 'none';

    // Render in reverse chronological order (newest first)
    [...completed].reverse().forEach((task, index) => {
        // Original index in completed array
        const originalIndex = completed.length - 1 - index;
        
        const row = document.createElement('tr');
        
        let deviationBadgeHtml = '';
        if (task.deviation === 0) {
            deviationBadgeHtml = '<span class="deviation-badge ontime">No Prazo</span>';
        } else if (task.deviation < 0) {
            deviationBadgeHtml = `<span class="deviation-badge early">Adiantado (${formatFriendlyDuration(Math.abs(task.deviation))})</span>`;
        } else {
            deviationBadgeHtml = `<span class="deviation-badge late">Atrasado (${formatFriendlyDuration(task.deviation)})</span>`;
        }

        row.innerHTML = `
            <td><strong>${task.name}</strong></td>
            <td>${task.material}</td>
            <td>${task.qty}</td>
            <td>${formatFriendlyDuration(task.duration)}</td>
            <td>${formatFriendlyDateTime(task.plannedEnd)}</td>
            <td>${formatFriendlyDateTime(task.actualEnd)}</td>
            <td>${deviationBadgeHtml}</td>
            <td>
                <button class="ctrl-btn btn-delete" onclick="deleteCompletedItem(${originalIndex})" title="Excluir do Histórico">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                    </svg>
                </button>
            </td>
        `;
        list.appendChild(row);
    });
}

function renderCancelledHistory() {
    const list = document.getElementById('cancelled-list');
    const emptyState = document.getElementById('cancelled-empty');
    
    list.innerHTML = '';
    
    if (cancelled.length === 0) {
        emptyState.style.display = 'block';
        return;
    }
    emptyState.style.display = 'none';

    // Render in reverse chronological order (newest first)
    [...cancelled].reverse().forEach((task, index) => {
        const originalIndex = cancelled.length - 1 - index;
        
        const row = document.createElement('tr');
        row.innerHTML = `
            <td><strong>${task.name}</strong></td>
            <td>${task.material}</td>
            <td>${task.qty}</td>
            <td>${formatFriendlyDuration(task.duration)}</td>
            <td>${task.cancelledAt ? new Date(task.cancelledAt).toLocaleString('pt-BR') : '---'}</td>
            <td class="reason-cell">${task.reason || 'Não informado'}</td>
            <td>
                <button class="ctrl-btn btn-delete" onclick="deleteCancelledItem(${originalIndex})" title="Excluir do Histórico">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                    </svg>
                </button>
            </td>
        `;
        list.appendChild(row);
    });
}

// --- Backup Operations ---
function exportBackup() {
    const backupData = {
        tasks: tasks,
        completed: completed,
        cancelled: cancelled,
        config: config,
        exportedAt: Date.now()
    };
    
    const jsonString = JSON.stringify(backupData, null, 4);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    const dateStr = new Date().toISOString().split('T')[0];
    a.href = url;
    a.download = `pcp_demandflow_backup_${dateStr}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function importBackup(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = function(evt) {
        try {
            const data = JSON.parse(evt.target.result);
            
            // Validate data structure basic requirements
            if (!data || !Array.isArray(data.tasks) || !Array.isArray(data.completed) || !Array.isArray(data.cancelled)) {
                throw new Error('Formato de backup inválido. Verifique se o arquivo JSON foi gerado por este aplicativo.');
            }
            
            if (confirm('A importação irá substituir todos os dados atuais da fila e históricos. Deseja prosseguir?')) {
                tasks = data.tasks;
                completed = data.completed;
                cancelled = data.cancelled;
                if (data.config) {
                    config = { ...config, ...data.config };
                }
                
                saveState();
                syncConfigToUI();
                
                recalculateSchedule();
                renderAll();
                alert('Backup importado com sucesso!');
            }
        } catch (err) {
            alert('Erro ao importar backup: ' + err.message);
        } finally {
            // Reset input value so same file can be imported again if needed
            e.target.value = '';
        }
    };
    reader.readAsText(file);
}

function generateTextReport(includeQueue, includeCompleted, includeCancelled) {
    let text = `RELATÓRIO DE DEMANDAS - MARKETING CHECK\n`;
    text += `Gerado em: ${new Date().toLocaleString('pt-BR')}\n`;
    text += `==========================================\n\n`;
    
    if (includeQueue) {
        text += `FILA DE ATIVIDADES ATIVAS\n`;
        text += `------------------------------------------\n`;
        if (tasks.length === 0) {
            text += `Nenhuma atividade ativa na fila.\n`;
        } else {
            tasks.forEach((task, idx) => {
                text += `${idx + 1}. Atividade: ${task.name}\n`;
                text += `   Material: ${task.material}\n`;
                text += `   Solicitante: ${task.requestor || '---'}\n`;
                text += `   Qtd: ${task.qty} | Duração: ${formatFriendlyDuration(task.duration)}\n`;
                text += `   Entrega Planejada: ${task.plannedEnd ? formatFriendlyDateTime(task.plannedEnd) : '---'}\n`;
                if (task.description) text += `   Obs: ${task.description}\n`;
                text += `\n`;
            });
        }
        text += `\n`;
    }
    
    if (includeCompleted) {
        text += `HISTÓRICO DE CONCLUÍDOS\n`;
        text += `------------------------------------------\n`;
        if (completed.length === 0) {
            text += `Nenhuma atividade concluída no histórico.\n`;
        } else {
            completed.forEach((task, idx) => {
                text += `${idx + 1}. Atividade: ${task.name}\n`;
                text += `   Material: ${task.material}\n`;
                text += `   Solicitante: ${task.requestor || '---'}\n`;
                text += `   Qtd: ${task.qty}\n`;
                text += `   Concluído em: ${task.actualEnd ? formatFriendlyDateTime(task.actualEnd) : '---'}\n`;
                text += `\n`;
            });
        }
        text += `\n`;
    }
    
    if (includeCancelled) {
        text += `HISTÓRICO DE CANCELADOS\n`;
        text += `------------------------------------------\n`;
        if (cancelled.length === 0) {
            text += `Nenhuma atividade cancelada no histórico.\n`;
        } else {
            cancelled.forEach((task, idx) => {
                text += `${idx + 1}. Atividade: ${task.name}\n`;
                text += `   Material: ${task.material}\n`;
                text += `   Solicitante: ${task.requestor || '---'}\n`;
                text += `   Qtd: ${task.qty}\n`;
                text += `   Cancelado em: ${task.cancelledAt ? formatFriendlyDateTime(task.cancelledAt) : '---'}\n`;
                text += `   Motivo: ${task.cancelReason || 'Não informado'}\n`;
                text += `\n`;
            });
        }
        text += `\n`;
    }
    
    text += `==========================================\n`;
    text += `Marketing Check - Gerenciador de PCP`;
    return text;
}

// --- Supabase Flow ---
function initSupabase() {
    let url = localStorage.getItem('SUPABASE_URL');
    let key = localStorage.getItem('SUPABASE_ANON_KEY');
    
    // Fallback padrão para o banco de dados da empresa no Brasil (Supabase)
    if (!url || !key) {
        url = 'https://kqnpdpmscgnjivwtdjty.supabase.co';
        key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtxbnBkcG1zY2duaml2d3RkanR5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM2NjE5MDQsImV4cCI6MjA5OTIzNzkwNH0.SPfad8FcP42kyb1s6RND_VLYilXuMe9xPeEwEo4eNy4';
    }
    
    const statusDiv = document.getElementById('supabase-status');
    
    if (url && key && window.supabase) {
        try {
            supabaseClient = window.supabase.createClient(url, key);
            if (statusDiv) {
                statusDiv.textContent = 'Status: Conectado (Supabase)';
                statusDiv.style.color = '#3ecf8e';
            }
            console.log('Supabase client initialized successfully.');
        } catch (err) {
            console.error('Failed to init Supabase client:', err);
            supabaseClient = null;
            if (statusDiv) {
                statusDiv.textContent = 'Status: Erro de Conexão';
                statusDiv.style.color = '#ef4444';
            }
        }
    } else {
        supabaseClient = null;
        if (statusDiv) {
            statusDiv.textContent = 'Status: Desconectado (Local)';
            statusDiv.style.color = 'var(--text-secondary)';
        }
    }
}

function openSupabaseModal() {
    document.getElementById('supabase-modal').classList.add('active');
    document.getElementById('supabase-url').value = localStorage.getItem('SUPABASE_URL') || 'https://fklutvpfpgpkvukxrugb.supabase.co';
    document.getElementById('supabase-key').value = localStorage.getItem('SUPABASE_ANON_KEY') || '';
}

function closeSupabaseModal() {
    document.getElementById('supabase-modal').classList.remove('active');
}

async function handleSupabaseConnect(e) {
    e.preventDefault();
    const url = document.getElementById('supabase-url').value.trim();
    const key = document.getElementById('supabase-key').value.trim();
    
    if (!url || !key) {
        alert('Por favor, preencha todos os campos.');
        return;
    }
    
    if (!window.supabase) {
        alert('Biblioteca do Supabase não foi carregada pelo CDN. Verifique sua conexão.');
        return;
    }
    
    try {
        const client = window.supabase.createClient(url, key);
        // Test query
        const { data, error } = await client
            .from('MerketingCheck')
            .select('state')
            .eq('id', 1)
            .single();
            
        if (error && error.code !== 'PGRST116') {
            throw error;
        }
        
        // Save to localStorage
        localStorage.setItem('SUPABASE_URL', url);
        localStorage.setItem('SUPABASE_ANON_KEY', key);
        supabaseClient = client;
        
        // Update status UI
        document.getElementById('supabase-status').textContent = 'Status: Conectado (Supabase)';
        document.getElementById('supabase-status').style.color = '#3ecf8e';
        
        // Sync data
        if (data && data.state && Object.keys(data.state).length > 0) {
            if (confirm('Dados encontrados no Supabase! Deseja carregar esses dados e substituir a fila local atual? (Se cancelar, os dados locais serão enviados para o Supabase)')) {
                const s = data.state;
                if (s.config) config = { ...config, ...s.config };
                if (s.tasks) tasks = s.tasks;
                if (s.completed) completed = s.completed;
                if (s.cancelled) cancelled = s.cancelled;
                
                syncConfigToUI();
                recalculateSchedule();
                renderAll();
                alert('Dados importados do Supabase com sucesso!');
            } else {
                await saveState();
                alert('Dados locais sincronizados e enviados para o Supabase!');
            }
        } else {
            await saveState();
            alert('Conectado ao Supabase! Dados locais sincronizados e gravados na nuvem.');
        }
        
        closeSupabaseModal();
    } catch (err) {
        alert('Erro ao conectar ao Supabase: ' + err.message + '\n\nCertifique-se de que a tabela MerketingCheck possui a coluna "state" do tipo jsonb.');
    }
}

async function disconnectSupabase() {
    if (confirm('Tem certeza que deseja desconectar do Supabase? Seus dados continuarão sendo salvos localmente.')) {
        // Desloga antes de remover credenciais
        if (supabaseClient) {
            await supabaseClient.auth.signOut().catch(() => {});
        }
        localStorage.removeItem('SUPABASE_URL');
        localStorage.removeItem('SUPABASE_ANON_KEY');
        supabaseClient = null;
        const statusDiv = document.getElementById('supabase-status');
        if (statusDiv) {
            statusDiv.textContent = 'Status: Desconectado (Local)';
            statusDiv.style.color = 'var(--text-secondary)';
        }
        // Oculta tela de login caso esteja visível
        const loginOverlay = document.getElementById('login-overlay');
        if (loginOverlay) loginOverlay.classList.remove('active');
        const btnLogout = document.getElementById('btn-logout');
        if (btnLogout) btnLogout.style.display = 'none';

        closeSupabaseModal();
        
        // Recarrega dados locais
        await loadState();
        recalculateSchedule();
        renderAll();
        alert('Supabase desconectado! Usando banco de dados local.');
    }
}

// --- Supabase Authentication Flow ---
async function setupAuth() {
    const loginOverlay = document.getElementById('login-overlay');
    const btnLogout = document.getElementById('btn-logout');

    if (!supabaseClient) {
        // Se o Supabase não estiver configurado, permite usar localmente sem exigir login
        if (loginOverlay) loginOverlay.classList.remove('active');
        if (btnLogout) btnLogout.style.display = 'none';
        
        // Exibe o painel para permitir configuração
        const supabasePanel = document.getElementById('supabase-panel');
        if (supabasePanel) supabasePanel.style.display = 'block';
        
        // Oculta painel de logout do sidebar
        const sidebarLogoutPanel = document.getElementById('sidebar-logout-panel');
        if (sidebarLogoutPanel) sidebarLogoutPanel.style.display = 'none';
        return;
    }
    
    // Escuta mudanças de estado de autenticação (login/logout)
    supabaseClient.auth.onAuthStateChange(async (event, session) => {
        const supabasePanel = document.getElementById('supabase-panel');
        const sidebarLogoutPanel = document.getElementById('sidebar-logout-panel');
        
        if (session) {
            console.log("Usuário autenticado:", session.user.email);
            if (loginOverlay) loginOverlay.classList.remove('active');
            if (btnLogout) btnLogout.style.display = 'inline-flex';
            if (sidebarLogoutPanel) sidebarLogoutPanel.style.display = 'block';
            
            // Controle de visibilidade do painel do Supabase (apenas para administrador)
            const email = session.user.email ? session.user.email.toLowerCase() : '';
            const isAdmin = email.includes('luanaweber') || email === 'luanaw@weg.net';
            if (supabasePanel) {
                supabasePanel.style.display = isAdmin ? 'block' : 'none';
            }
            
            // Recarrega o estado atual associado ao usuário
            await loadState();
            runSixMonthsRetention();
            recalculateSchedule();
            renderAll();
        } else {
            console.log("Nenhum usuário autenticado.");
            if (loginOverlay) loginOverlay.classList.add('active');
            if (btnLogout) btnLogout.style.display = 'none';
            if (supabasePanel) supabasePanel.style.display = 'none';
            if (sidebarLogoutPanel) sidebarLogoutPanel.style.display = 'none';
            
            // Limpa dados em memória
            config = {};
            tasks = [];
            completed = [];
            cancelled = [];
            initDefaultConfig();
            renderAll();
        }
    });

    // Registra os botões da tela de login
    const btnGoogle = document.getElementById('btn-login-google');
    if (btnGoogle) {
        btnGoogle.addEventListener('click', async () => {
            try {
                const { error } = await supabaseClient.auth.signInWithOAuth({
                    provider: 'google',
                    options: {
                        redirectTo: window.location.origin
                    }
                });
                if (error) throw error;
            } catch (err) {
                alert('Erro ao entrar com Google: ' + err.message);
            }
        });
    }

    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('login-email').value.trim();
            const password = document.getElementById('login-password').value;
            
            try {
                const { error } = await supabaseClient.auth.signInWithPassword({
                    email,
                    password
                });
                if (error) throw error;
            } catch (err) {
                alert('Erro ao entrar: ' + err.message);
            }
        });
    }

    const btnSignup = document.getElementById('btn-signup');
    if (btnSignup) {
        btnSignup.addEventListener('click', async () => {
            const email = document.getElementById('login-email').value.trim();
            const password = document.getElementById('login-password').value;
            
            if (!email || !password) {
                alert('Por favor, digite e-mail e senha para criar a conta.');
                return;
            }
            
            try {
                const { error } = await supabaseClient.auth.signUp({
                    email,
                    password
                });
                if (error) throw error;
                alert('Cadastro efetuado! Se o e-mail de confirmação estiver habilitado, valide sua conta antes de logar.');
            } catch (err) {
                alert('Erro ao cadastrar: ' + err.message);
            }
        });
    }

    const btnLogoutActual = document.getElementById('btn-logout');
    if (btnLogoutActual) {
        // Remove listener anterior se houver substituindo a referência
        const newBtnLogout = btnLogoutActual.cloneNode(true);
        btnLogoutActual.parentNode.replaceChild(newBtnLogout, btnLogoutActual);
        newBtnLogout.addEventListener('click', async () => {
            if (confirm('Deseja realmente sair?')) {
                await supabaseClient.auth.signOut();
            }
        });
    }

    const btnSidebarLogout = document.getElementById('btn-sidebar-logout');
    if (btnSidebarLogout) {
        // Remove listener anterior se houver substituindo a referência
        const newBtnSidebarLogout = btnSidebarLogout.cloneNode(true);
        btnSidebarLogout.parentNode.replaceChild(newBtnSidebarLogout, btnSidebarLogout);
        newBtnSidebarLogout.addEventListener('click', async () => {
            if (confirm('Deseja realmente sair da conta?')) {
                await supabaseClient.auth.signOut();
            }
        });
    }
}

