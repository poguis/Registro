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

export const calculateBacklog = (category, totalWatched = 0) => {
    const { start_date: startStr, frequency: freq, days_of_week: daysOfWeek, type, pauses = [], quotas_history: history = [] } = category;
    
    if (!startStr) return null;

    const now = new Date();
    now.setHours(0, 0, 0, 0);

    const [y, m, d] = startStr.split('-').map(Number);
    const startDate = new Date(y, m - 1, d);

    let targetItems = 0;
    let validDaysPassed = 0;
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
                if (isActive) validDaysPassed++;
            }
        }
        current.setDate(current.getDate() + 1);
    }

    if (type === 'reading') {
        if (!freq) return null;
        if (freq > 0) {
            targetItems = validDaysPassed * freq;
        } else {
            targetItems = Math.floor(validDaysPassed / Math.abs(freq));
        }
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

    if (type === 'video' || (type === 'reading' && freq > 0)) {
        // Video or Reading with daily quota: Count based on work days
        if (backlogItems > 0) {
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

        if (adelantoItems > 0) {
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
    } else if (type === 'reading' && freq < 0) {
        // Reading with 1 item every N days (freq < 0)
        // Fixed logic: atraso/adelanto is relative to completion of N-day cycles
        const N = Math.abs(freq);
        if (backlogItems > 0) {
            daysAtraso = validDaysPassed - (totalWatched * N);
            if (daysAtraso < 0) daysAtraso = 0;
        }
        if (adelantoItems > 0) {
            // How many days ahead? (Total work capacity - days used)
            // Example: totalWatched=2, N=3. Total capacity = 6 days. If validDaysPassed=4, then 2 days ahead.
            adelantoDays = (totalWatched * N) - validDaysPassed;
            if (adelantoDays < 0) adelantoDays = 0;
        }
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
