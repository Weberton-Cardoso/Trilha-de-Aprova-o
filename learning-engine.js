/**
 * learning-engine.js — Learning Intelligence Engine v2
 *
 * PRINCÍPIO: a IA interpreta, o Engine calcula. Nunca o contrário.
 *
 * NOVIDADES v2:
 *  - Perfil Evolutivo: compara presente vs 30d e 60d atrás
 *  - Conquistas automáticas (recordes, marcos, sequências)
 *  - Simulações "E se..." (projeções de cenário)
 *  - Central de Insights (padrões comportamentais pré-calculados)
 *  - Linha do Tempo mensal
 *  - Dados estratégicos do perfil (concurso, data prova, horas/dia, objetivo)
 *  - Missões inteligentes pré-calculadas (geradas pela IA via prompt enriquecido)
 *  - Fase da preparação dinâmica (pré-edital / pós-edital / reta final)
 *  - Memória de longo prazo via Diário (recomendações passadas + impacto)
 */

/* ============================================================
   HELPERS INTERNOS
   ============================================================ */

const _LIE = {
  dias(isoDate) {
    if (!isoDate) return null;
    return Math.round((Date.now() - new Date(isoDate + 'T12:00:00').getTime()) / 86400000);
  },
  soma(arr, campo) { return arr.reduce((s, x) => s + (Number(x[campo]) || 0), 0); },
  taxa(arr) {
    const t = this.soma(arr, 'numQuestoes');
    return t > 0 ? Math.round((this.soma(arr, 'acertos') / t) * 100) : null;
  },
  hoje() { return todayISO(); },
  daysAgo(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString().slice(0, 10);
  },
  monthStart(monthsAgo = 0) {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - monthsAgo);
    return d.toISOString().slice(0, 10);
  }
};

/* ============================================================
   1. QUESTÕES
   ============================================================ */

function _calcQuestoes(tentativas) {
  const total   = _LIE.soma(tentativas, 'numQuestoes');
  const acertos = _LIE.soma(tentativas, 'acertos');
  const taxa    = total > 0 ? Math.round((acertos / total) * 100) : null;

  const mapaDisc = {};
  tentativas.forEach(t => {
    const d = (t.disciplina || 'Sem disciplina').trim();
    if (!mapaDisc[d]) mapaDisc[d] = { total: 0, acertos: 0 };
    mapaDisc[d].total   += Number(t.numQuestoes) || 0;
    mapaDisc[d].acertos += Number(t.acertos)     || 0;
  });
  const porDisc = Object.entries(mapaDisc).map(([disciplina, v]) => ({
    disciplina, total: v.total, acertos: v.acertos,
    taxa: v.total > 0 ? Math.round((v.acertos / v.total) * 100) : null
  })).sort((a, b) => b.total - a.total);

  const hoje14 = _LIE.daysAgo(14), hoje28 = _LIE.daysAgo(28);
  const taxaRec = _LIE.taxa(tentativas.filter(t => t.data >= hoje14));
  const taxaAnt = _LIE.taxa(tentativas.filter(t => t.data >= hoje28 && t.data < hoje14));
  const tendencia14d = (taxaRec != null && taxaAnt != null) ? taxaRec - taxaAnt : null;

  const u7  = tentativas.filter(t => t.data >= _LIE.daysAgo(6));
  const u30 = tentativas.filter(t => t.data >= _LIE.daysAgo(29));

  // Tendência por disciplina
  const tendDisc = porDisc.filter(d => d.total >= 5).map(d => {
    const r = tentativas.filter(t => t.disciplina === d.disciplina && t.data >= hoje14);
    const a = tentativas.filter(t => t.disciplina === d.disciplina && t.data >= hoje28 && t.data < hoje14);
    const tr = _LIE.taxa(r), ta = _LIE.taxa(a);
    return { ...d, tendencia: (tr != null && ta != null) ? tr - ta : null };
  });

  return {
    total, acertos, erros: total - acertos, taxa, tendencia14d,
    ultimos7:  { total: _LIE.soma(u7,'numQuestoes'),  acertos: _LIE.soma(u7,'acertos'),  taxa: _LIE.taxa(u7)  },
    ultimos30: { total: _LIE.soma(u30,'numQuestoes'), acertos: _LIE.soma(u30,'acertos'), taxa: _LIE.taxa(u30) },
    porDisc: porDisc.slice(0, 12),
    fracas:  porDisc.filter(d => d.taxa != null && d.taxa < 60  && d.total >= 5).slice(0, 5),
    fortes:  porDisc.filter(d => d.taxa != null && d.taxa >= 75 && d.total >= 5).slice(0, 5),
    caindo:  tendDisc.filter(d => d.tendencia != null && d.tendencia <= -8).sort((a,b) => a.tendencia - b.tendencia).slice(0, 4),
    subindo: tendDisc.filter(d => d.tendencia != null && d.tendencia >= 8).sort((a,b) => b.tendencia - a.tendencia).slice(0, 4)
  };
}

/* ============================================================
   2. TEMPO / CONSISTÊNCIA
   ============================================================ */

function _calcTempo(tentativas, cicloSessoes) {
  const datas = new Set([...tentativas.map(t => t.data), ...cicloSessoes.map(s => s.data)].filter(Boolean));

  let sequencia = 0;
  for (let i = 0; i < 365; i++) {
    if (datas.has(_LIE.daysAgo(i))) sequencia++;
    else if (i > 0) break;
  }

  let dias30 = 0, dias14 = 0;
  for (let i = 0; i < 30; i++) {
    if (datas.has(_LIE.daysAgo(i))) { dias30++; if (i < 14) dias14++; }
  }

  const min30 = cicloSessoes.filter(s => s.data >= _LIE.daysAgo(29)).reduce((s,x) => s + (x.minutos||0), 0);

  const prodDia = {};
  tentativas.forEach(t => {
    if (!t.data) return;
    const ds = new Date(t.data + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long' });
    if (!prodDia[ds]) prodDia[ds] = { q: 0, a: 0 };
    prodDia[ds].q += Number(t.numQuestoes) || 0;
    prodDia[ds].a += Number(t.acertos)     || 0;
  });
  const melhorDia = Object.entries(prodDia).filter(([,v]) => v.q >= 5)
    .sort((a,b) => (b[1].a/b[1].q) - (a[1].a/a[1].q))[0]?.[0] || null;

  const datasOrd = [...datas].sort();
  const ultimoDia = datasOrd[datasOrd.length - 1] || null;

  return {
    sequencia, dias30, dias14, consistencia30: Math.round((dias30/30)*100),
    min30, melhorDia, ultimoDia, diasSemEstudar: ultimoDia ? _LIE.dias(ultimoDia) : null,
    ultimos30: Array.from({length:30}, (_,i) => ({ data: _LIE.daysAgo(29-i), estudou: datas.has(_LIE.daysAgo(29-i)) }))
  };
}

/* ============================================================
   3. CICLO DE ESTUDOS
   ============================================================ */

function _calcCiclo(ciclos, cicloMaterias, cicloSessoes, tentativas, revisoes) {
  const cicloAtivo = ciclos[0] || null;
  if (!cicloAtivo) return { ativo: null, materias: [], atrasadas: [], semRevisar7: [] };

  const norm = s => (s||'').trim().toLowerCase();
  const materias = cicloMaterias.filter(m => m.cicloId === cicloAtivo.id).map(m => {
    const sessoes     = cicloSessoes.filter(s => s.cicloMateriaId === m.id);
    const tentsMat    = tentativas.filter(t => norm(t.disciplina) === norm(m.nome));
    const ultimaSessao= sessoes.map(s => s.data).filter(Boolean).sort().pop() || null;
    const ultimaRev   = revisoes.filter(r => norm(r.materia)===norm(m.nome)||norm(r.disciplina)===norm(m.nome))
                          .map(r=>r.data).filter(Boolean).sort().pop() || null;
    return {
      nome: m.nome, peso: m.peso||1,
      minutosEstudados: _LIE.soma(sessoes,'minutos'),
      diasSemEstudar: ultimaSessao ? _LIE.dias(ultimaSessao) : 30,
      diasSemRevisar: ultimaRev ? _LIE.dias(ultimaRev) : null,
      taxa: _LIE.taxa(tentsMat),
      totalQuestoes: _LIE.soma(tentsMat,'numQuestoes')
    };
  });

  return {
    ativo: { id: cicloAtivo.id, nome: cicloAtivo.nome },
    materias,
    atrasadas: [...materias].filter(m=>m.diasSemEstudar>3).sort((a,b)=>b.diasSemEstudar-a.diasSemEstudar).slice(0,5),
    semRevisar7: materias.filter(m=>m.diasSemRevisar!=null&&m.diasSemRevisar>=7)
      .sort((a,b)=>(b.diasSemRevisar||0)-(a.diasSemRevisar||0)).slice(0,5)
  };
}

/* ============================================================
   4. ÍNDICE DE APROVAÇÃO (0–100)
   ============================================================ */

function _calcIndice({ questoes, tempo, ciclo, edital, simulados, diagnosticos }) {
  const fase = questoes.total < 200 ? 'inicial' : questoes.total < 1000 ? 'rampup' : 'intensivo';
  const P = {
    inicial:   { taxa:10, consistencia:30, cobertura:25, tempo:20, simulados:5,  diag:10 },
    rampup:    { taxa:25, consistencia:20, cobertura:20, tempo:15, simulados:10, diag:10 },
    intensivo: { taxa:35, consistencia:15, cobertura:15, tempo:10, simulados:20, diag:5  }
  }[fase];
  const indice = Math.round(
    Math.min(100, questoes.taxa??50) * P.taxa/100 +
    tempo.consistencia30             * P.consistencia/100 +
    (edital.coberturaPercent??0)     * P.cobertura/100 +
    Math.min(100,(tempo.min30/30)*2) * P.tempo/100 +
    (simulados.total>0 ? Math.min(100,simulados.ultimaTaxa??0) : 0) * P.simulados/100 +
    Math.max(0,100-diagnosticos.ativos*10) * P.diag/100
  );
  return { indice: Math.min(100,Math.max(0,indice)), fase };
}

/* ============================================================
   5. INDICADORES AVANÇADOS
   ============================================================ */

function _calcMomentum(tentativas, cicloSessoes) {
  const q7  = _LIE.soma(tentativas.filter(t=>t.data>=_LIE.daysAgo(6)), 'numQuestoes');
  const q14 = _LIE.soma(tentativas.filter(t=>t.data>=_LIE.daysAgo(13)&&t.data<_LIE.daysAgo(6)), 'numQuestoes');
  const m7  = cicloSessoes.filter(s=>s.data>=_LIE.daysAgo(6)).reduce((s,x)=>s+(x.minutos||0),0);
  const m14 = cicloSessoes.filter(s=>s.data>=_LIE.daysAgo(13)&&s.data<_LIE.daysAgo(6)).reduce((s,x)=>s+(x.minutos||0),0);
  const nivel = (q7-q14>20||m7-m14>60)?'alto':(q7-q14<-20||m7-m14<-60)?'baixo':'estavel';
  return { nivel, questDelta: q7-q14, minDelta: m7-m14 };
}

function _calcSobrecarga(tentativas) {
  const u7 = tentativas.filter(t=>t.data>=_LIE.daysAgo(6));
  const total = _LIE.soma(u7,'numQuestoes');
  if (total < 10) return null;
  const m = {}; u7.forEach(t=>{const d=(t.disciplina||'').trim();m[d]=(m[d]||0)+(Number(t.numQuestoes)||0);});
  const [top] = Object.entries(m).sort((a,b)=>b[1]-a[1]);
  if (!top) return null;
  const pct = Math.round((top[1]/total)*100);
  return pct>=60 ? {disciplina:top[0],pct} : null;
}

function _calcRisco(tempo, questoes) {
  let score = 0;
  if (tempo.diasSemEstudar!=null&&tempo.diasSemEstudar>=3) score+=30;
  if (tempo.consistencia30<40) score+=20;
  if (questoes.tendencia14d!=null&&questoes.tendencia14d<-10) score+=25;
  if (tempo.sequencia<=1&&tempo.dias30<5) score+=25;
  return { score, nivel: score>=60?'alto':score>=30?'medio':'baixo' };
}

function _calcDNA(tentativas, cicloSessoes, tempo, questoes) {
  const prodDia = {};
  tentativas.forEach(t => {
    if (!t.data) return;
    const ds = new Date(t.data+'T12:00:00').toLocaleDateString('pt-BR',{weekday:'long'});
    if (!prodDia[ds]) prodDia[ds]={q:0,a:0};
    prodDia[ds].q+=Number(t.numQuestoes)||0; prodDia[ds].a+=Number(t.acertos)||0;
  });
  const melhorDiaSemana = Object.entries(prodDia).filter(([,v])=>v.q>=5)
    .sort((a,b)=>(b[1].a/b[1].q)-(a[1].a/a[1].q))[0]?.[0]||null;

  const tiposMap = {};
  cicloSessoes.forEach(s=>{ if(s.tipoEstudo) tiposMap[s.tipoEstudo]=(tiposMap[s.tipoEstudo]||0)+(s.minutos||0); });
  const melhorMetodo = Object.entries(tiposMap).sort((a,b)=>b[1]-a[1])[0]?.[0]||null;

  const discComVolume = (questoes.porDisc||[]).filter(d=>d.total>=20);
  const retencaoEstimada = discComVolume.length>0
    ? Math.round(discComVolume.filter(d=>(d.taxa||0)>=70).length/discComVolume.length*100) : null;

  return {
    melhorDiaSemana, melhorMetodo, retencaoEstimada,
    velocidade: Math.round((questoes.ultimos30?.total||0)/30),
    disciplinaCrescendo: (questoes.subindo||[])[0]?.disciplina||null,
    disciplinaConsolidada: (questoes.fortes||[])[0]?.disciplina||null
  };
}

/* ============================================================
   6. PERFIL EVOLUTIVO — presente vs passado
   ============================================================ */

function _calcPerfilEvolutivo(tentativas, cicloSessoes, diario) {
  // Taxa 30-60 dias atrás
  const t30_60 = tentativas.filter(t=>t.data>=_LIE.daysAgo(59)&&t.data<_LIE.daysAgo(29));
  const t0_30  = tentativas.filter(t=>t.data>=_LIE.daysAgo(29));
  const taxa30  = _LIE.taxa(t0_30);
  const taxa60  = _LIE.taxa(t30_60);
  const varTaxa30 = (taxa30!=null&&taxa60!=null) ? taxa30-taxa60 : null;

  // Velocidade 30-60 vs 0-30
  const vel30 = Math.round(_LIE.soma(t0_30,'numQuestoes')/30);
  const vel60 = Math.round(_LIE.soma(t30_60,'numQuestoes')/30);
  const varVel = vel60>0 ? Math.round(((vel30-vel60)/vel60)*100) : null;

  // Consistência 30-60 vs 0-30
  const datas = new Set([...tentativas.map(t=>t.data),...cicloSessoes.map(s=>s.data)].filter(Boolean));
  let dias0_30=0, dias30_60=0;
  for(let i=0;i<60;i++){const d=_LIE.daysAgo(i); if(datas.has(d)){if(i<30)dias0_30++;else dias30_60++;}}
  const varConsistencia = Math.round((dias0_30/30)*100) - Math.round((dias30_60/30)*100);

  // Melhor taxa por disciplina — comparação
  const discMelhorou = [], discPiorou = [];
  const mapaHoje={}, mapa60={};
  t0_30.forEach(t=>{const d=(t.disciplina||'').trim();if(!mapaHoje[d])mapaHoje[d]={q:0,a:0};mapaHoje[d].q+=Number(t.numQuestoes)||0;mapaHoje[d].a+=Number(t.acertos)||0;});
  t30_60.forEach(t=>{const d=(t.disciplina||'').trim();if(!mapa60[d])mapa60[d]={q:0,a:0};mapa60[d].q+=Number(t.numQuestoes)||0;mapa60[d].a+=Number(t.acertos)||0;});
  Object.entries(mapaHoje).forEach(([disc,v])=>{
    if(v.q<5) return;
    const h = v.q>0?Math.round((v.a/v.q)*100):null;
    const ant = mapa60[disc];
    if(!ant||ant.q<5) return;
    const a = Math.round((ant.a/ant.q)*100);
    if(h-a>=8) discMelhorou.push({disciplina:disc,delta:h-a,taxaAtual:h,taxaAnterior:a});
    if(h-a<=-8) discPiorou.push({disciplina:disc,delta:h-a,taxaAtual:h,taxaAnterior:a});
  });

  // Recomendação passada mais impactante (do diário)
  const recomPassadas = (diario||[])
    .filter(e=>e.prioridadeSeguinte&&e.data<_LIE.daysAgo(14))
    .slice(0,3)
    .map(e=>({ data:e.data, recomendacao:e.prioridadeSeguinte, taxaNaEpoca:e.taxaHoje }));

  return {
    varTaxa30d: varTaxa30,
    varVelocidade30d: varVel,
    varConsistencia30d: varConsistencia,
    discMelhorou: discMelhorou.sort((a,b)=>b.delta-a.delta).slice(0,3),
    discPiorou: discPiorou.sort((a,b)=>a.delta-b.delta).slice(0,3),
    recomPassadas
  };
}

/* ============================================================
   7. CONQUISTAS AUTOMÁTICAS
   ============================================================ */

function _calcConquistas(tentativas, tempo, cicloSessoes, diario) {
  const total = _LIE.soma(tentativas,'numQuestoes');
  const conquistas = [];

  // Marcos de questões
  for (const marco of [100,500,1000,2000,5000,10000]) {
    if (total >= marco) conquistas.push({ tipo:'marco', icone:'📚', titulo:`${marco.toLocaleString('pt-BR')} questões resolvidas`, conquistadoEm: null });
  }

  // Sequência atual
  if (tempo.sequencia>=3)  conquistas.push({tipo:'sequencia',icone:'🔥',titulo:`${tempo.sequencia} dias consecutivos de estudo`});

  // Recorde de sequência (via diário)
  const maxSeq = Math.max(tempo.sequencia, ...(diario||[]).map(e=>e.sequencia||0));
  if (tempo.sequencia>0&&tempo.sequencia===maxSeq&&maxSeq>=5) {
    conquistas.push({tipo:'recorde',icone:'🏆',titulo:`Novo recorde de sequência: ${maxSeq} dias!`});
  }

  // Taxa geral acima de marcos
  const taxa = _LIE.taxa(tentativas);
  if (taxa!=null) {
    for (const marco of [60,70,75,80,85]) {
      if (taxa>=marco) conquistas.push({tipo:'taxa',icone:'⭐',titulo:`Taxa geral acima de ${marco}%`});
    }
  }

  // Minutos de ciclo — horas totais
  const minTotais = _LIE.soma(cicloSessoes,'minutos');
  for (const horas of [10,50,100,200,500]) {
    if (minTotais>=horas*60) conquistas.push({tipo:'horas',icone:'⏱️',titulo:`${horas} horas de estudo registradas`});
  }

  return conquistas.slice(-5); // apenas as 5 mais recentes/relevantes
}

/* ============================================================
   8. SIMULAÇÕES "E SE..."
   ============================================================ */

function _calcSimulacoes({ questoes, tempo, ciclo, edital, perfilEstrategico }) {
  const sims = [];
  const vel  = Math.max(1, Math.round((questoes.ultimos30?.total||0)/30));
  const cons = tempo.consistencia30;
  const taxa = questoes.taxa ?? 50;

  // E se estudar +30min/dia?
  const minDia = tempo.min30>0 ? Math.round(tempo.min30/30) : 0;
  const diasAteProv = perfilEstrategico?.diasAteProva ?? null;
  if (diasAteProv && minDia>0) {
    const minExtra = diasAteProv * 30;
    sims.push({
      cenario: 'Estudar +30 min por dia',
      impacto: `${Math.round(minExtra/60)} horas extras até a prova — equivale a ~${Math.round(minExtra/60/2)} sessões completas adicionais`
    });
  }

  // E se aumentar taxa +5pp?
  if (taxa < 85) {
    const novoIndice = Math.min(100, Math.round(taxa + 5));
    sims.push({
      cenario: 'Aumentar taxa de acertos em 5pp',
      impacto: `Taxa geral passaria de ${taxa}% para ~${novoIndice}% — impacto direto no Índice de Aprovação`
    });
  }

  // E se estudar todos os dias (consistência 100%)?
  if (cons < 90) {
    const diasBonus = 30 - tempo.dias30;
    const questoesBonus = diasBonus * vel;
    sims.push({
      cenario: 'Estudar todos os dias este mês',
      impacto: `+${diasBonus} dias de estudo = ~${questoesBonus} questões extras (+${Math.round((diasBonus/30)*100)}% de volume)`
    });
  }

  // E se resolver a matéria mais atrasada hoje?
  const atrasada = (ciclo.atrasadas||[])[0];
  if (atrasada) {
    sims.push({
      cenario: `Retomar ${atrasada.nome} hoje`,
      impacto: `Estava há ${atrasada.diasSemEstudar} dias sem estudar — retomar eliminaria o maior atraso do seu ciclo`
    });
  }

  // E se cobrir o restante do edital?
  if (edital.coberturaPercent!=null && edital.coberturaPercent<100) {
    const restante = 100 - edital.coberturaPercent;
    sims.push({
      cenario: 'Cobrir os tópicos restantes do edital',
      impacto: `Faltam ${restante}% do edital — isso pode ser o fator decisivo entre passar ou não na 1ª fase`
    });
  }

  return sims.slice(0, 4);
}

/* ============================================================
   9. CENTRAL DE INSIGHTS (padrões comportamentais pré-calculados)
   ============================================================ */

function _calcInsights({ tentativas, cicloSessoes, tempo, questoes, ciclo, dna, perfilEvolutivo }) {
  const insights = [];

  // Melhor dia da semana
  if (dna.melhorDiaSemana) {
    insights.push({
      categoria: 'Comportamental',
      icone: '📅',
      titulo: `Você rende mais às ${dna.melhorDiaSemana}s`,
      detalhe: 'Baseado na sua taxa de acerto por dia da semana — planeje as disciplinas mais difíceis para esse dia.'
    });
  }

  // Disciplina consolidada
  if (dna.disciplinaConsolidada) {
    insights.push({
      categoria: 'Desempenho',
      icone: '✅',
      titulo: `${dna.disciplinaConsolidada} está consolidada`,
      detalhe: `Taxa ≥75% com volume significativo — reduza o tempo aqui e redirecione para as disciplinas fracas.`
    });
  }

  // Disciplina crescendo
  if (dna.disciplinaCrescendo) {
    insights.push({
      categoria: 'Tendência',
      icone: '📈',
      titulo: `${dna.disciplinaCrescendo} está em alta`,
      detalhe: 'Maior subida de taxa nos últimos 14 dias — o método atual está funcionando. Mantenha o ritmo.'
    });
  }

  // Método de estudo mais eficaz
  if (dna.melhorMetodo) {
    insights.push({
      categoria: 'Método',
      icone: '📖',
      titulo: `Você estuda mais via ${dna.melhorMetodo}`,
      detalhe: 'Tipo de sessão com maior tempo acumulado no Ciclo — considere diversificar para identificar qual método gera melhor retenção.'
    });
  }

  // Evolução
  if (perfilEvolutivo.varTaxa30d!=null && perfilEvolutivo.varTaxa30d>=5) {
    insights.push({
      categoria: 'Evolução',
      icone: '🚀',
      titulo: `Taxa de acertos subiu ${perfilEvolutivo.varTaxa30d}pp em 30 dias`,
      detalhe: `Comparado com os 30 dias anteriores — você está claramente evoluindo. Continue.`
    });
  }
  if (perfilEvolutivo.varTaxa30d!=null && perfilEvolutivo.varTaxa30d<=-5) {
    insights.push({
      categoria: 'Atenção',
      icone: '⚠️',
      titulo: `Taxa de acertos caiu ${Math.abs(perfilEvolutivo.varTaxa30d)}pp em 30 dias`,
      detalhe: 'Pode indicar fadiga, sobrecarga ou lacunas teóricas acumuladas. Revise os diagnósticos de erro.'
    });
  }

  // Melhorou em alguma disciplina
  (perfilEvolutivo.discMelhorou||[]).slice(0,2).forEach(d=>{
    insights.push({
      categoria: 'Conquista',
      icone: '🎯',
      titulo: `${d.disciplina}: +${d.delta}pp em 30 dias`,
      detalhe: `Taxa foi de ${d.taxaAnterior}% para ${d.taxaAtual}% — resultado real do seu esforço.`
    });
  });

  // Piorou
  (perfilEvolutivo.discPiorou||[]).slice(0,1).forEach(d=>{
    insights.push({
      categoria: 'Alerta',
      icone: '📉',
      titulo: `${d.disciplina}: ${d.delta}pp em 30 dias`,
      detalhe: `Taxa caiu de ${d.taxaAnterior}% para ${d.taxaAtual}% — priorize esta disciplina nos próximos dias.`
    });
  });

  // Retenção geral
  if (dna.retencaoEstimada!=null) {
    const label = dna.retencaoEstimada>=70?'boa':'abaixo do esperado';
    insights.push({
      categoria: 'Retenção',
      icone: dna.retencaoEstimada>=70?'🧠':'💡',
      titulo: `Retenção estimada: ${dna.retencaoEstimada}% (${label})`,
      detalhe: `${dna.retencaoEstimada}% das disciplinas com volume suficiente têm taxa ≥70%.`
    });
  }

  return insights.slice(0, 10);
}

/* ============================================================
   10. LINHA DO TEMPO MENSAL
   ============================================================ */

function _calcLinhaDoTempo(tentativas, cicloSessoes, diario) {
  const meses = [];
  for (let m = 0; m < 12; m++) {
    const inicio = _LIE.monthStart(m+1);
    const fim    = _LIE.monthStart(m);
    const tMes   = tentativas.filter(t=>t.data>=inicio&&t.data<fim);
    const sMes   = cicloSessoes.filter(s=>s.data>=inicio&&s.data<fim);
    if (!tMes.length && !sMes.length) continue;

    const data   = new Date(inicio+'T12:00:00');
    const label  = data.toLocaleDateString('pt-BR',{month:'long',year:'numeric'});
    const dDiario= (diario||[]).find(e=>e.data>=inicio&&e.data<fim);

    meses.push({
      mes: inicio.slice(0,7),
      label,
      questoes: _LIE.soma(tMes,'numQuestoes'),
      acertos:  _LIE.soma(tMes,'acertos'),
      taxa:     _LIE.taxa(tMes),
      minutos:  _LIE.soma(sMes,'minutos'),
      indice:   dDiario?.indiceAprovacao ?? null,
      coach:    dDiario?.coach ?? null
    });
  }
  return meses.reverse();
}

/* ============================================================
   11. FASE DA PREPARAÇÃO (baseada em dados estratégicos)
   ============================================================ */

function _inferirFase(perfilEstrategico, questoes) {
  const dias = perfilEstrategico?.diasAteProva ?? null;
  if (dias!=null) {
    if (dias>180) return 'pre_edital';
    if (dias>60)  return 'pos_edital';
    return 'reta_final';
  }
  // Fallback: volume de questões
  return questoes.total < 200 ? 'pre_edital' : questoes.total < 1000 ? 'pos_edital' : 'reta_final';
}

/* ============================================================
   12. DIÁRIO DO MENTOR
   ============================================================ */

const _DIARIO_KEY = 'mentor_diario_v2';

function _lerDiario() {
  try { return JSON.parse(localStorage.getItem(_DIARIO_KEY)||'[]'); } catch { return []; }
}
function _salvarNoDiario(entrada) {
  try {
    const d = _lerDiario().filter(e=>e.data!==entrada.data);
    d.unshift(entrada);
    localStorage.setItem(_DIARIO_KEY, JSON.stringify(d.slice(0,365)));
  } catch {}
}
window.lerDiarioMentor = _lerDiario;

/* ============================================================
   13. buildLearningProfile() — PONTO DE ENTRADA PRINCIPAL
   ============================================================ */

function buildLearningProfile() {
  const { tentativas, ciclos, cicloMaterias, cicloSessoes, simulados,
          resumos, revisoes, errosQuestoes, diagnosticosErro, editais, perfis } = state;

  const perfilAtivo = perfis.find(p=>p.id===db.perfilAtivoId)||perfis[0]||{};
  const perfilEst   = {
    concurso:        perfilAtivo.concurso       ?? null,
    cargo:           perfilAtivo.cargo          ?? null,
    banca:           perfilAtivo.banca          ?? null,
    dataProva:       perfilAtivo.dataProva       ?? null,
    horasDia:        perfilAtivo.horasDia        ?? null,
    objetivoAcerto:  perfilAtivo.objetivoAcerto  ?? null,
    diasAteProva:    perfilAtivo.dataProva
      ? Math.max(0, Math.round((new Date(perfilAtivo.dataProva+'T12:00:00')-Date.now())/86400000))
      : null
  };

  // Sub-cálculos base
  const questoes = _calcQuestoes(tentativas);
  const tempo    = _calcTempo(tentativas, cicloSessoes);
  const ciclo    = _calcCiclo(ciclos, cicloMaterias, cicloSessoes, tentativas, revisoes);

  const topicosEdital = editais.flatMap(e=>(e.materias||[]).flatMap(m=>m.topicos||[]));
  const edital = {
    coberturaPercent: topicosEdital.length>0
      ? Math.round(topicosEdital.filter(t=>t.concluido).length/topicosEdital.length*100) : null
  };

  const simOrdenados = [...simulados].sort((a,b)=>(a.data||'').localeCompare(b.data||''));
  const ultimoSim    = simOrdenados[simOrdenados.length-1]||null;
  const simCalc = {
    total: simulados.length,
    ultimaTaxa: ultimoSim?.taxa??null, ultimaData: ultimoSim?.data??null,
    tendencia: simOrdenados.length>=2?(simOrdenados[simOrdenados.length-1].taxa||0)-(simOrdenados[simOrdenados.length-2].taxa||0):null
  };

  const diagAtivos = diagnosticosErro.filter(d=>d.status==='ativo');
  const diagCalc = {
    ativos: diagAtivos.length,
    errosPendentes: errosQuestoes.filter(e=>!e.analisado).length,
    padroes: diagAtivos.slice(0,5).map(d=>({padrao:d.padrao,disciplina:d.disciplina,recomendacao:d.recomendacao}))
  };

  const ultimoResumo = [...resumos].sort((a,b)=>(a.data||'').localeCompare(b.data||'')).pop();
  const resumosCalc  = { total:resumos.length, ultimaData:ultimoResumo?.data??null };

  // Indicadores
  const indiceObj  = _calcIndice({questoes,tempo,ciclo,edital,simulados:simCalc,diagnosticos:diagCalc});
  const momentum   = _calcMomentum(tentativas, cicloSessoes);
  const sobrecarga = _calcSobrecarga(tentativas);
  const risco      = _calcRisco(tempo, questoes);
  const dna        = _calcDNA(tentativas, cicloSessoes, tempo, questoes);
  const fase       = _inferirFase(perfilEst, questoes);

  // Diário + delta do índice
  const diario      = _lerDiario();
  const indiceAnt   = diario[1]?.indiceAprovacao ?? null;
  const indiceDelta = indiceAnt!=null ? indiceObj.indice-indiceAnt : null;

  // Novas camadas
  const perfilEvolutivo = _calcPerfilEvolutivo(tentativas, cicloSessoes, diario);
  const conquistas      = _calcConquistas(tentativas, tempo, cicloSessoes, diario);
  const simulacoes      = _calcSimulacoes({questoes,tempo,ciclo,edital,perfilEstrategico:perfilEst});
  const insights        = _calcInsights({tentativas,cicloSessoes,tempo,questoes,ciclo,dna,perfilEvolutivo});
  const linhaDoTempo    = _calcLinhaDoTempo(tentativas, cicloSessoes, diario);

  // Resumo executivo para o prompt da IA (texto denso + estruturado)
  const resumoExec = [
    `PERFIL: ${perfilAtivo.nome||'Histórico Geral'} | Fase: ${fase} | Índice: ${indiceObj.indice}/100${indiceDelta!=null?` (${indiceDelta>=0?'+':''}${indiceDelta} vs 15d atrás)`:''}`,
    perfilEst.concurso  ? `Concurso: ${perfilEst.concurso}${perfilEst.cargo?` — ${perfilEst.cargo}`:''}${perfilEst.banca?` | Banca: ${perfilEst.banca}`:''}` : '',
    perfilEst.diasAteProva!=null ? `Dias até a prova: ${perfilEst.diasAteProva}` : '',
    perfilEst.objetivoAcerto ? `Meta de acerto: ${perfilEst.objetivoAcerto}% | Atual: ${questoes.taxa??'—'}%` : '',
    `Questões: ${questoes.total} total | Taxa: ${questoes.taxa??'—'}% | Tend 14d: ${questoes.tendencia14d!=null?(questoes.tendencia14d>=0?'+':'')+questoes.tendencia14d+'pp':'—'}`,
    `Consistência: ${tempo.consistencia30}% | Sequência: ${tempo.sequencia}d | Momentum: ${momentum.nivel}`,
    questoes.fracas.length ? `Fracas: ${questoes.fracas.map(d=>`${d.disciplina}(${d.taxa}%)`).join(', ')}` : '',
    ciclo.atrasadas.length ? `Atrasadas no ciclo: ${ciclo.atrasadas.slice(0,3).map(m=>`${m.nome}(${m.diasSemEstudar}d)`).join(', ')}` : '',
    diagCalc.ativos        ? `Diagnósticos ativos: ${diagCalc.ativos}` : '',
    perfilEvolutivo.varTaxa30d!=null ? `Variação de taxa nos últimos 30d: ${perfilEvolutivo.varTaxa30d>=0?'+':''}${perfilEvolutivo.varTaxa30d}pp` : ''
  ].filter(Boolean).join('\n');

  return {
    perfilNome:   perfilAtivo.nome||'Histórico Geral',
    hoje:         _LIE.hoje(),
    perfilEstrategico: perfilEst,
    questoes, tempo, ciclo,
    revisoes: { revistasHoje:revisoes.filter(r=>r.data===_LIE.hoje()).length, semRevisar7:ciclo.semRevisar7||[] },
    diagnosticos: diagCalc,
    simulados: simCalc,
    resumos: resumosCalc,
    edital,
    indicadores: {
      indiceAprovacao: indiceObj.indice, indiceDelta, indiceFase: indiceObj.fase,
      faseDaPreparacao: fase, momentum, sobrecarga, riscoAbandono: risco, dna
    },
    perfilEvolutivo, conquistas, simulacoes, insights, linhaDoTempo,
    resumoExecutivo: resumoExec
  };
}
window.buildLearningProfile = buildLearningProfile;

/* ============================================================
   14. SALVAR NO DIÁRIO (chamado pelo Mentor após análise)
   ============================================================ */

function salvarEntradaDiario({profile, analise}) {
  _salvarNoDiario({
    data: profile.hoje,
    indiceAprovacao: profile.indicadores.indiceAprovacao,
    indiceAnterior: profile.indicadores.indiceDelta!=null
      ? profile.indicadores.indiceAprovacao - profile.indicadores.indiceDelta : null,
    taxaHoje: profile.questoes.taxa,
    sequencia: profile.tempo.sequencia,
    principalConquista: analise?.resumoDia?.saudacao||'',
    principalProblema:  (analise?.alertas||[]).find(a=>a.nivel==='critico')?.mensagem||'',
    prioridadeSeguinte: (analise?.prioridades||[])[0]?.acao||'',
    coach: analise?.coach?.mensagem||''
  });
}
window.salvarEntradaDiario = salvarEntradaDiario;
