// 시간표 사이트(숨김 창) 안에서 실행되어, 사이트 계산 엔진의 결과 데이터만 뽑아낸다.
// __TEACHER__, __WEEK__(0-based, -1=오늘 기준) 는 Python 쪽에서 치환된다.
(function () {
    try {
        if (typeof TimetableEngine === 'undefined' || !TimetableEngine.getTeachersList) return { ready: false };
        // 위젯 초기화(변경사항 로드) 완료 전이면 대기
        const list = document.getElementById('widgetPeriodList');
        if (!list || !list.children.length) return { ready: false };

        const teachers = TimetableEngine.getTeachersList().map(t => t.name)
            .sort((a, b) => a.startsWith('가상') - b.startsWith('가상') || a.localeCompare(b, 'ko'));
        let name = __TEACHER__ || '';
        if (!name) { try { name = localStorage.getItem('dongrae_saved_teacher_name') || ''; } catch (e) {} }
        if (!name || !TimetableEngine.getTeacherByName(name)) return { ready: true, teachers, teacher: null };

        TimetableEngine.setCurrentWeekAndDayFromToday();
        const curW = TimetableEngine.getWeekIndex();
        const today = TimetableEngine.getSelectedDayOfWeek() || '월';
        const total = TimetableEngine.getTotalWeeks();
        const reqW = __WEEK__;
        const w = (reqW >= 0 && reqW < total) ? reqW : curW;
        const merged = TimetableEngine.calculateMergedSchedule(name, w);
        const weekDays = TimetableEngine.getWeekDays(w) || [];
        const guide = TimetableEngine.getTeacherSemesterGuidance(name) || {};

        const norm = cell => {
            let type = 'free', subject = '공강', room = '';
            if (typeof cell === 'string') {
                if (cell.trim()) {
                    type = 'class';
                    const p = cell.split('(');
                    subject = p[0].trim(); room = p[1] ? p[1].replace(')', '').trim() : '';
                }
            } else if (cell && typeof cell === 'object') {
                subject = cell.displaySubject || '공강'; room = cell.room || '';
                // 시험·행사일에도 원래 수업명을 보조 정보로 남긴다
                const op = (cell.originalVal || '').split('\n').filter(Boolean);   // ["309(선택1)", "N_창경"]
                const oSub = op[1] || '', oRoom = op[0] || '';
                const ev = () => { const label = cell.badgeText || subject;
                    if (oSub) { subject = oSub; room = [oRoom, label].filter(Boolean).join(' · '); } else { subject = label; room = ''; } };
                if (cell.isHoliday) { type = 'holiday'; subject = cell.badgeText || subject; room = ''; }
                else if (cell.isFestival || cell.isFieldTrip || cell.isGradeExam) { type = 'event'; ev(); }
                else if (cell.isGonggangJido) { type = 'duty'; }
                else if (cell.isDangyeo) { type = 'dangyeo'; }
                else if (cell.isAbsent) { type = 'absent'; subject = `결강 (대강: ${cell.substituteTeacher})`; room = cell.modReason || ''; }
                else if (cell.isSubstitute) { type = 'sub'; subject = `보강 · ${cell.displaySubject}`; room = `${cell.absentTeacher} 대강`; }
                else if (cell.isFree || subject === '공강') { type = 'free'; subject = '공강'; room = ''; }
                else type = 'class';
            }
            return { type, subject: String(subject).replace(/\n/g, ' '), room: String(room).replace(/\n/g, ' ') };
        };

        const days = {};
        ['월', '화', '수', '목', '금'].forEach(d => {
            const info = weekDays.find(x => x.dayOfWeek === d) || {};
            days[d] = {
                date: info.fullDateStr || '',
                title: info.type && info.type !== 'normal' ? (info.title || '') : '',
                periods: ((merged && merged.matrix && merged.matrix[d]) || Array(7).fill('')).slice(0, 7).map(norm),
                jido: (guide.jidoList || []).filter(g => g.weekNum === w + 1 && g.day === d)
                    .map(g => ({ period: g.period, target: g.target })),
                lunchDuty: (guide.lunchList || []).some(l => l.weekNum === w + 1 && l.dayOfWeek === d),
            };
        });
        const t = TimetableEngine.getTeacherByName(name) || {};
        const range = weekDays.length ? `${weekDays[0].dateStr} ~ ${weekDays[weekDays.length - 1].dateStr}` : '';
        return { ready: true, teachers, teacher: name, homeroom: t.homeroom || '', week: w + 1, currentWeek: curW + 1, totalWeeks: total, range, today, days };
    } catch (e) {
        return { ready: false, error: String(e) };
    }
})()
