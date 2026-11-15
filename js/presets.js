/* Forexia — modèles de stratégies (modifiables dans le formulaire). */
(function (root) {
  'use strict';
  const list = [
    {
      id: 'rsi', name: 'RSI — surachat / survente',
      description: 'Achète quand le RSI sort de la zone de survente, vend quand il sort de la zone de surachat.',
      longEntry: 'CROSS_UP(RSI(14), 30)', longExit: 'RSI(14) > 60',
      shortEntry: 'CROSS_DOWN(RSI(14), 70)', shortExit: 'RSI(14) < 40',
      stopLossPips: 80, takeProfitPips: 0,
      plots: 'RSI(14)',
    },
    {
      id: 'macd', name: 'MACD — croisement de la ligne de signal',
      description: 'Toujours en position : achat quand le MACD croise sa ligne de signal à la hausse, vente à la baisse.',
      longEntry: 'CROSS_UP(MACD(12,26,9), MACD_SIGNAL(12,26,9))', longExit: '',
      shortEntry: 'CROSS_DOWN(MACD(12,26,9), MACD_SIGNAL(12,26,9))', shortExit: '',
      stopLossPips: 0, takeProfitPips: 0,
      plots: 'MACD(12,26,9), MACD_SIGNAL(12,26,9)',
    },
    {
      id: 'ma', name: 'Moyennes mobiles — croisement 20 / 50',
      description: 'Suivi de tendance : achat au croisement haussier de la SMA 20 sur la SMA 50, vente au croisement baissier.',
      longEntry: 'CROSS_UP(SMA(20), SMA(50))', longExit: '',
      shortEntry: 'CROSS_DOWN(SMA(20), SMA(50))', shortExit: '',
      stopLossPips: 0, takeProfitPips: 0,
      plots: 'SMA(20), SMA(50)',
    },
    {
      id: 'stoch', name: 'Stochastique + filtre de tendance EMA 200',
      description: 'Achat sur rebond du stochastique en tendance haussière (prix > EMA 200), vente à l\'inverse.',
      longEntry: 'CROSS_UP(STOCH_K(14,3,3), STOCH_D(14,3,3)) AND STOCH_K(14,3,3) < 30 AND CLOSE > EMA(200)',
      longExit: 'STOCH_K(14,3,3) > 80',
      shortEntry: 'CROSS_DOWN(STOCH_K(14,3,3), STOCH_D(14,3,3)) AND STOCH_K(14,3,3) > 70 AND CLOSE < EMA(200)',
      shortExit: 'STOCH_K(14,3,3) < 20',
      stopLossPips: 100, takeProfitPips: 200,
      plots: 'EMA(200), STOCH_K(14,3,3), STOCH_D(14,3,3)',
    },
    {
      id: 'bb', name: 'Bandes de Bollinger — retour à la moyenne',
      description: 'Achat sous la bande basse, vente au-dessus de la bande haute, sortie sur la moyenne.',
      longEntry: 'CLOSE < BB_LOWER(20,2)', longExit: 'CLOSE > BB_MIDDLE(20,2)',
      shortEntry: 'CLOSE > BB_UPPER(20,2)', shortExit: 'CLOSE < BB_MIDDLE(20,2)',
      stopLossPips: 120, takeProfitPips: 0,
      plots: 'BB_UPPER(20,2), BB_MIDDLE(20,2), BB_LOWER(20,2)',
    },
    {
      id: 'combo', name: 'Combinée — tendance EMA + MACD + RSI',
      description: 'Entrée dans le sens de la tendance (EMA 50 / 200) quand le MACD confirme et que le RSI n\'est pas en excès.',
      longEntry: 'EMA(50) > EMA(200) AND CROSS_UP(MACD(12,26,9), MACD_SIGNAL(12,26,9)) AND RSI(14) < 65',
      longExit: 'CROSS_DOWN(MACD(12,26,9), MACD_SIGNAL(12,26,9))',
      shortEntry: 'EMA(50) < EMA(200) AND CROSS_DOWN(MACD(12,26,9), MACD_SIGNAL(12,26,9)) AND RSI(14) > 35',
      shortExit: 'CROSS_UP(MACD(12,26,9), MACD_SIGNAL(12,26,9))',
      stopLossPips: 100, takeProfitPips: 250,
      plots: 'EMA(50), EMA(200), MACD_HIST(12,26,9)',
    },
  ];
  root.Forexia = root.Forexia || {};
  root.Forexia.presets = { list };
})(typeof window !== 'undefined' ? window : globalThis);
