/** Setores (os mesmos rótulos usados na base de ações dos EUA). */
export const SECTORS = [
  'Tecnologia', 'Saúde', 'Financeiro', 'Consumo discric.', 'Consumo básico', 'Industrial',
  'Energia', 'Materiais', 'Serv. públicos', 'Comunicações', 'Imobiliário', 'ETF (diversificado)',
];

export const COUNTRIES = [
  'EUA', 'Portugal', 'Alemanha', 'França', 'Países Baixos', 'Espanha', 'Itália', 'Reino Unido', 'Suíça',
  'Dinamarca', 'Irlanda', 'Suécia', 'China', 'Japão', 'Taiwan', 'Canadá', 'Singapura', 'Brasil', 'Uruguai',
  'Global', 'Emergentes', 'Outro',
];

export const FLAGS = {
  'EUA': '🇺🇸', 'Portugal': '🇵🇹', 'Alemanha': '🇩🇪', 'França': '🇫🇷', 'Países Baixos': '🇳🇱', 'Espanha': '🇪🇸',
  'Itália': '🇮🇹', 'Reino Unido': '🇬🇧', 'Suíça': '🇨🇭', 'Dinamarca': '🇩🇰', 'Irlanda': '🇮🇪', 'Suécia': '🇸🇪',
  'China': '🇨🇳', 'Japão': '🇯🇵', 'Taiwan': '🇹🇼', 'Canadá': '🇨🇦', 'Singapura': '🇸🇬', 'Brasil': '🇧🇷',
  'Uruguai': '🇺🇾', 'Global': '🌍', 'Emergentes': '🌏',
};

/** Bolsa (campo x da base) → país da empresa. */
export const EXCHANGE_COUNTRY = {
  'Lisboa': 'Portugal', 'Xetra': 'Alemanha', 'Paris': 'França', 'Amesterdão': 'Países Baixos', 'Madrid': 'Espanha',
  'Milão': 'Itália', 'Londres': 'Reino Unido', 'Zurique': 'Suíça', 'Copenhaga': 'Dinamarca', 'Dublin': 'Irlanda',
};

/** Sufixo Yahoo → país (para ações fora da base local). */
export const SUFFIX_COUNTRY = {
  '.LS': 'Portugal', '.DE': 'Alemanha', '.F': 'Alemanha', '.PA': 'França', '.AS': 'Países Baixos', '.MC': 'Espanha',
  '.MI': 'Itália', '.L': 'Reino Unido', '.SW': 'Suíça', '.CO': 'Dinamarca', '.IR': 'Irlanda', '.ST': 'Suécia',
  '.HK': 'China', '.SS': 'China', '.SZ': 'China', '.T': 'Japão', '.TW': 'Taiwan', '.TO': 'Canadá', '.SA': 'Brasil',
};

/** Setor e país das ações da base que não trazem setor (Europa e temáticas dos EUA), pelo símbolo Yahoo. */
export const OVERRIDES = {
  // EUA — populares e temáticas
  BABA: ['Consumo discric.', 'China'], SHOP: ['Tecnologia', 'Canadá'], SPOT: ['Comunicações', 'Suécia'],
  XPEV: ['Consumo discric.', 'China'], NIO: ['Consumo discric.', 'China'], LI: ['Consumo discric.', 'China'],
  RIVN: ['Consumo discric.', 'EUA'], LCID: ['Consumo discric.', 'EUA'], PSNY: ['Consumo discric.', 'Suécia'],
  NKLA: ['Industrial', 'EUA'], ARRY: ['Industrial', 'EUA'], PLUG: ['Industrial', 'EUA'], QS: ['Consumo discric.', 'EUA'],
  CHPT: ['Industrial', 'EUA'], RUN: ['Industrial', 'EUA'], FCEL: ['Industrial', 'EUA'], AUR: ['Tecnologia', 'EUA'],
  ROKU: ['Comunicações', 'EUA'], U: ['Tecnologia', 'EUA'], SNOW: ['Tecnologia', 'EUA'], RBLX: ['Comunicações', 'EUA'],
  TOST: ['Tecnologia', 'EUA'], SOFI: ['Financeiro', 'EUA'], AFRM: ['Financeiro', 'EUA'], NU: ['Financeiro', 'Brasil'],
  SE: ['Comunicações', 'Singapura'], GRAB: ['Industrial', 'Singapura'], PDD: ['Consumo discric.', 'China'],
  MELI: ['Consumo discric.', 'Uruguai'], BYND: ['Consumo básico', 'EUA'], RKLB: ['Industrial', 'EUA'],
  JOBY: ['Industrial', 'EUA'], ACHR: ['Industrial', 'EUA'], LUNR: ['Industrial', 'EUA'], ASTS: ['Comunicações', 'EUA'],
  SOUN: ['Tecnologia', 'EUA'], BBAI: ['Tecnologia', 'EUA'], ALAB: ['Tecnologia', 'EUA'], IONQ: ['Tecnologia', 'EUA'],
  RGTI: ['Tecnologia', 'EUA'], MARA: ['Tecnologia', 'EUA'], RIOT: ['Tecnologia', 'EUA'], MSTR: ['Tecnologia', 'EUA'],
  ARM: ['Tecnologia', 'Reino Unido'], TSM: ['Tecnologia', 'Taiwan'],
  // Lisboa
  'GALP.LS': ['Energia'], 'EDP.LS': ['Serv. públicos'], 'EDPR.LS': ['Serv. públicos'], 'JMT.LS': ['Consumo básico'],
  'SON.LS': ['Consumo básico'], 'BCP.LS': ['Financeiro'], 'NOS.LS': ['Comunicações'], 'COR.LS': ['Materiais'],
  'RENE.LS': ['Serv. públicos'], 'NVG.LS': ['Materiais'], 'SEM.LS': ['Materiais'], 'ALTR.LS': ['Materiais'],
  'CTT.LS': ['Industrial'], 'EGL.LS': ['Industrial'], 'IBS.LS': ['Consumo discric.'],
  // Xetra
  'SAP.DE': ['Tecnologia'], 'SIE.DE': ['Industrial'], 'ALV.DE': ['Financeiro'], 'DTE.DE': ['Comunicações'],
  'MBG.DE': ['Consumo discric.'], 'BMW.DE': ['Consumo discric.'], 'VOW3.DE': ['Consumo discric.'], 'BAS.DE': ['Materiais'],
  'ADS.DE': ['Consumo discric.'], 'BAYN.DE': ['Saúde'], 'DBK.DE': ['Financeiro'], 'IFX.DE': ['Tecnologia'],
  'P911.DE': ['Consumo discric.'], 'DHL.DE': ['Industrial'], 'RWE.DE': ['Serv. públicos'],
  // Paris
  'MC.PA': ['Consumo discric.'], 'OR.PA': ['Consumo básico'], 'RMS.PA': ['Consumo discric.'], 'TTE.PA': ['Energia'],
  'SAN.PA': ['Saúde'], 'SU.PA': ['Industrial'], 'AI.PA': ['Materiais'], 'BNP.PA': ['Financeiro'], 'CS.PA': ['Financeiro'],
  'AIR.PA': ['Industrial'], 'DG.PA': ['Industrial'], 'KER.PA': ['Consumo discric.'], 'RI.PA': ['Consumo básico'],
  'SAF.PA': ['Industrial'],
  // Amesterdão
  'ASML.AS': ['Tecnologia'], 'ADYEN.AS': ['Financeiro'], 'INGA.AS': ['Financeiro'], 'PHIA.AS': ['Saúde'],
  'AD.AS': ['Consumo básico'], 'HEIA.AS': ['Consumo básico'],
  // Madrid
  'IBE.MC': ['Serv. públicos'], 'SAN.MC': ['Financeiro'], 'ITX.MC': ['Consumo discric.'], 'BBVA.MC': ['Financeiro'],
  'TEF.MC': ['Comunicações'], 'REP.MC': ['Energia'],
  // Milão
  'STLAM.MI': ['Consumo discric.', 'Países Baixos'], 'ENEL.MI': ['Serv. públicos'], 'RACE.MI': ['Consumo discric.'],
  'ISP.MI': ['Financeiro'], 'UCG.MI': ['Financeiro'], 'ENI.MI': ['Energia'],
  // Dublin
  'RYA.IR': ['Industrial'],
  // Londres
  'SHEL.L': ['Energia'], 'AZN.L': ['Saúde'], 'HSBA.L': ['Financeiro'], 'BP.L': ['Energia'], 'ULVR.L': ['Consumo básico'],
  'GSK.L': ['Saúde'], 'RIO.L': ['Materiais'], 'DGE.L': ['Consumo básico'], 'BATS.L': ['Consumo básico'],
  'VOD.L': ['Comunicações'], 'BARC.L': ['Financeiro'], 'LLOY.L': ['Financeiro'], 'RR.L': ['Industrial'],
  'GLEN.L': ['Materiais'], 'BA.L': ['Industrial'], 'TSCO.L': ['Consumo básico'],
  // Zurique
  'NESN.SW': ['Consumo básico'], 'NOVN.SW': ['Saúde'], 'ROG.SW': ['Saúde'], 'UBSG.SW': ['Financeiro'],
  'ZURN.SW': ['Financeiro'], 'ABBN.SW': ['Industrial'], 'CFR.SW': ['Consumo discric.'],
  // Copenhaga
  'NOVO-B.CO': ['Saúde'], 'ORSTED.CO': ['Serv. públicos'], 'MAERSK-B.CO': ['Industrial'], 'DSV.CO': ['Industrial'],
};
