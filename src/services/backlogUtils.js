export const getLocalDateString = (date = new Date()) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

export const isDatePaused = (date, pauses) => {
    if (!pauses || pauses.length === 0) return false;
    const dStr = getLocalDateString(date);
    return pauses.some(p => {
        const start = p.pause_start;
        const end = p.pause_end || '9999-12-31';
        return dStr >= start && dStr <= end;
    });
};


export const getQuotasForDate = (date, category) => {
    const dStr = getLocalDateString(date);
    const { start_date: startStr, days_of_week: daysOfWeek, frequency, quotas_history: history } = category;
    
    // 0. If before start, no quota
    if (startStr && dStr < startStr) return { Monday: 0, Tuesday: 0, Wednesday: 0, Thursday: 0, Friday: 0, Saturday: 0, Sunday: 0 };

    // 1. Check History first
    if (history && history.length > 0) {
        const record = history.find(h => {
            const hStart = h.start_date;
            const hEnd = h.end_date || '9999-12-31';
            return dStr >= hStart && dStr <= hEnd;
        });
        if (record) {
            try {
                return typeof record.quotas === 'string' ? JSON.parse(record.quotas) : record.quotas;
            } catch (e) {
                return record.quotas;
            }
        }
    }

    // 2. Fallback to current daysOfWeek
    let q = { Monday: 0, Tuesday: 0, Wednesday: 0, Thursday: 0, Friday: 0, Saturday: 0, Sunday: 0 };
    try {
        const parsed = typeof daysOfWeek === 'string' ? JSON.parse(daysOfWeek) : daysOfWeek;
        if (Array.isArray(parsed)) {
            // Legacy array format
            parsed.forEach(day => { if (q.hasOwnProperty(day)) q[day] = frequency || 0; });
        } else if (parsed && typeof parsed === 'object') {
            q = { ...q, ...parsed };
        }
    } catch (e) {}
    return q;
};

// Fase 7.4b: frecuencia de lectura vigente en una fecha = la del período del historial que la
// cubre o, si ese período no la tiene (NULL, datos de antes de la 7.4b), la de la categoría.
export const getFrequencyForDate = (date, category) => {
    const dStr = getLocalDateString(date);
    const history = category.quotas_history || [];
    const record = history.find(h => dStr >= h.start_date && dStr <= (h.end_date || '9999-12-31'));
    if (record && record.frequency !== null && record.frequency !== undefined) return Number(record.frequency);
    return category.frequency;
};

const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
const lcm = (a, b) => (a / gcd(a, b)) * b;

export const calculateBacklog = (category, totalWatched = 0) => {
    const { start_date: startStr, frequency: catFreq, days_of_week: daysOfWeek, type, pauses = [], quotas_history: history = [] } = category;

    if (!startStr) return null;

    const now = new Date();
    now.setHours(0, 0, 0, 0);

    const [y, m, d] = startStr.split('-').map(Number);
    const startDate = new Date(y, m - 1, d);

    let targetItems = 0;
    let validDaysPassed = 0;
    // Lectura (7.4b): cada día activo aporta la frecuencia de SU período: n > 0 suma n; n < 0 suma
    // 1/|n|. Las fracciones se acumulan exactas (días por cada N) y se redondea hacia abajo solo el
    // total, así partir un período sin cambiar N no cambia la meta.
    let readingIntItems = 0;
    const readingDaysByN = new Map();
    let current = new Date(startDate);
    const dayMap = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    // Loop to calculate target total and valid days passed
    while (current <= now) {
        if (!isDatePaused(current, pauses)) {
            const dayName = dayMap[current.getDay()];
            const activeQuotas = getQuotasForDate(current, category);
            
            if (type === 'video') {
                targetItems += activeQuotas[dayName] || 0;
            } else {
                // Reading logic: count as valid day if day has any quota/selection
                let isActive = false;
                if (Array.isArray(activeQuotas)) {
                    isActive = activeQuotas.includes(dayName);
                } else if (activeQuotas && activeQuotas[dayName] > 0) {
                    isActive = true;
                }
                if (isActive) {
                    validDaysPassed++;
                    const f = Number(getFrequencyForDate(current, category)) || 0;
                    if (f > 0) readingIntItems += f;
                    else if (f < 0) readingDaysByN.set(-f, (readingDaysByN.get(-f) || 0) + 1);
                }
            }
        }
        current.setDate(current.getDate() + 1);
    }

    // Meta exacta de lectura como fracción readingNum / readingDen (para los días de atraso/adelanto).
    let readingNum = 0;
    let readingDen = 1;
    if (type === 'reading') {
        // Sin ninguna frecuencia (ni en la categoría ni en los períodos), como antes: sin cálculo.
        if (!catFreq && !(history || []).some(h => h.frequency)) return null;
        readingDen = [...readingDaysByN.keys()].reduce((acc, n) => lcm(acc, n), 1);
        readingNum = readingIntItems * readingDen;
        for (const [n, days] of readingDaysByN) readingNum += days * (readingDen / n);
        targetItems = Math.floor(readingNum / readingDen);
    }

    let backlogItems = targetItems - totalWatched;
    if (backlogItems < 0) backlogItems = 0;

    let adelantoItems = 0;
    if (targetItems - totalWatched < 0) {
        adelantoItems = totalWatched - targetItems;
    }

    // Days calculation
    let daysAtraso = 0;
    let adelantoDays = 0;

    // Use working pauses for projections (indefinite pause ends today for calculation purposes)
    const todayStr = getLocalDateString(now);
    const workingPauses = pauses.map(p => {
        if (!p.pause_end) return { ...p, pause_end: todayStr };
        return p;
    });

    // Lectura (7.4b): la rama ("n por día" frente a "1 cada N") la decide el período de HOY para el
    // atraso y el de MAÑANA para el adelanto (que se cuenta desde mañana). Con un solo período es
    // la frecuencia de siempre.
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const freqHoy = type === 'reading' ? Number(getFrequencyForDate(now, category)) || 0 : 0;
    const freqManana = type === 'reading' ? Number(getFrequencyForDate(tomorrow, category)) || 0 : 0;
    const walkAtraso = type === 'video' || freqHoy > 0;
    const walkAdelanto = type === 'video' || freqManana > 0;

    if (walkAtraso || walkAdelanto) {
        // Video or Reading with daily quota: Count based on work days
        if (walkAtraso && backlogItems > 0) {
            let tempBacklog = backlogItems;
            let checkDate = new Date(now);
            const safetyMax = 3650;
            let safety = 0;

            while (tempBacklog > 0 && safety < safetyMax) {
                if (!isDatePaused(checkDate, workingPauses)) {
                    const activeQuotas = getQuotasForDate(checkDate, category);
                    const dayName = dayMap[checkDate.getDay()];
                    const quotaForDay = activeQuotas[dayName] || 0;

                    if (quotaForDay > 0) {
                        tempBacklog -= quotaForDay;
                        daysAtraso++;
                    }
                }
                checkDate.setDate(checkDate.getDate() - 1);
                safety++;
                if (getLocalDateString(checkDate) < startStr) break;
            }
        }

        if (walkAdelanto && adelantoItems > 0) {
            let tempAdelanto = adelantoItems;
            let checkDate = new Date(now);
            checkDate.setDate(checkDate.getDate() + 1);
            const safetyMax = 3650;
            let safety = 0;

            while (tempAdelanto > 0 && safety < safetyMax) {
                if (!isDatePaused(checkDate, workingPauses)) {
                    const activeQuotas = getQuotasForDate(checkDate, category);
                    const dayName = dayMap[checkDate.getDay()];
                    const quotaForDay = activeQuotas[dayName] || 0;

                    if (quotaForDay > 0) {
                        tempAdelanto -= quotaForDay;
                        adelantoDays++;
                    }
                }
                checkDate.setDate(checkDate.getDate() + 1);
                safety++;
            }
        }
    }
    // Reading with 1 item every N days (freq < 0): atraso/adelanto relative to completion of N-day
    // cycles. 7.4b: expressed in units of the N of the period (today for atraso, tomorrow for
    // adelanto) over the EXACT target fraction; with a single period N it is the same formula as
    // before: (validDays/N − watched) × N = validDays − watched × N.
    if (type === 'reading' && !walkAtraso && freqHoy < 0 && backlogItems > 0) {
        const N = Math.abs(freqHoy);
        daysAtraso = Math.ceil(((readingNum - totalWatched * readingDen) * N) / readingDen);
        if (daysAtraso < 0) daysAtraso = 0;
    }
    if (type === 'reading' && !walkAdelanto && freqManana < 0 && adelantoItems > 0) {
        // Example: totalWatched=2, N=3. Total capacity = 6 days. If validDaysPassed=4, then 2 days ahead.
        const N = Math.abs(freqManana);
        adelantoDays = Math.ceil(((totalWatched * readingDen - readingNum) * N) / readingDen);
        if (adelantoDays < 0) adelantoDays = 0;
    }

    const unitLabel = type === 'video' ? 'Caps' : 'Tomos';
    
    return {
        diffDays: Math.ceil(daysAtraso),
        backlogItems: Math.floor(backlogItems),
        adelantoDays: Math.ceil(adelantoDays),
        adelantoItems: Math.floor(adelantoItems),
        unit: unitLabel,
        targetItems,
        validDaysPassed
    };
};

export const getAbsoluteEpisodeCount = (series, seasonNum, episodeNum) => {
    let count = 0;
    if (!series.seasons || !Array.isArray(series.seasons)) return episodeNum - 1;
    for (let i = 1; i < seasonNum; i++) {
        const sea = series.seasons.find(se => se.season_number === i);
        count += sea ? sea.episode_count : 0;
    }
    return count + (episodeNum - 1);
};

export const getWatchedCountSinceStart = (series) => {
    const currentAbs = getAbsoluteEpisodeCount(series, series.current_season, series.current_episode);
    const initS = series.initial_season || 1;
    const initE = series.initial_episode || 1;
    const initialAbs = getAbsoluteEpisodeCount(series, initS, initE);

    let diff = currentAbs - initialAbs;
    if (series.status === 'Terminado' || series.status === 'En espera') diff += 1;

    return (diff > 0 ? diff : 0) + (series.cycle_offset || 0);
};

export const calculateBacklogV2 = (category, seriesList = []) => {
    // Match main screen's global logic: Target - Sum(all series progress in this category)
    let totalWatched = 0;
    seriesList.forEach(s => {
        totalWatched += getWatchedCountSinceStart(s);
    });

    const calc = calculateBacklog(category, totalWatched);
    if (!calc) return null;

    return {
        items: calc.backlogItems,
        days: calc.diffDays,
        adelantoItems: calc.adelantoItems,
        adelantoDays: calc.adelantoDays,
        targetItems: calc.targetItems
    };
};
