(function () {
  "use strict";

  var MODEL_YEARS = 35;
  var DEFAULT_DISCOUNT_RATE = 0.08;

  function toNumber(value, fallback) {
    var n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function round(value, decimals) {
    var p = Math.pow(10, decimals || 0);
    return Math.round(value * p) / p;
  }

  function sum(values) {
    var total = 0;
    for (var i = 0; i < values.length; i += 1) total += values[i];
    return total;
  }

  function npv(rate, cashflows) {
    var total = 0;
    for (var t = 0; t < cashflows.length; t += 1) {
      total += cashflows[t] / Math.pow(1 + rate, t);
    }
    return total;
  }

  function irrNewtonRaphson(cashflows, guess) {
    var rate = toNumber(guess, 0.1);
    var maxIter = 200;
    var tolerance = 1e-7;

    for (var iter = 0; iter < maxIter; iter += 1) {
      var f = 0;
      var df = 0;
      for (var t = 0; t < cashflows.length; t += 1) {
        var denom = Math.pow(1 + rate, t);
        f += cashflows[t] / denom;
        if (t > 0) {
          df -= (t * cashflows[t]) / (denom * (1 + rate));
        }
      }

      if (Math.abs(df) < 1e-12) break;
      var nextRate = rate - f / df;
      if (!Number.isFinite(nextRate) || nextRate <= -0.9999 || nextRate > 10) break;
      if (Math.abs(nextRate - rate) < tolerance) return nextRate;
      rate = nextRate;
    }

    return null;
  }

  function annuityPayment(principal, annualRate, tenorYears) {
    if (principal <= 0 || tenorYears <= 0) return 0;
    if (annualRate === 0) return principal / tenorYears;
    var r = annualRate;
    return (principal * r) / (1 - Math.pow(1 + r, -tenorYears));
  }

  function normalizeOpexLine(line) {
    return {
      name: line.name || "Unnamed OPEX",
      year1: toNumber(line.year1, 0),
      escalation: toNumber(line.escalation, 0)
    };
  }

  function calcAsset(asset) {
    var technical = asset.technical || {};
    var revenue = asset.revenue || {};
    var opex = asset.opex || {};
    var capex = asset.capex || {};
    var debt = asset.debt || {};
    var itc = asset.itc || {};

    var mwdc = toNumber(technical.mwdc, 0);
    var yieldKwhPerKwp = toNumber(technical.yieldKwhPerKwp, 0);
    var availability = toNumber(technical.availability, 1);
    var degradation = toNumber(technical.degradation, 0);
    var assetLifeYears = Math.max(1, Math.floor(toNumber(technical.assetLifeYears, MODEL_YEARS)));

    var ppaPrice = toNumber(revenue.ppaPricePerMWh, 0);
    var ppaEsc = toNumber(revenue.ppaEscalation, 0);
    var ppaEndYear = Math.max(0, Math.floor(toNumber(revenue.ppaEndYear, 0)));
    var merchantPrice = toNumber(revenue.merchantPricePerMWh, 0);
    var merchantEsc = toNumber(revenue.merchantEscalation, 0);
    var curtailment = toNumber(revenue.curtailment, 0);

    var opexLines = Array.isArray(opex.lines) ? opex.lines.map(normalizeOpexLine) : [];
    var capexLines = Array.isArray(capex.lines) ? capex.lines : [];
    var unleveredCapex = sum(capexLines.map(function (l) { return toNumber(l.amount, 0); }));

    var loanSize = toNumber(debt.loanSize, 0);
    var interestRate = toNumber(debt.interestRate, 0);
    var tenorYears = Math.max(0, Math.floor(toNumber(debt.tenorYears, 0)));
    var dscrCovenant = toNumber(debt.dscrCovenant, 1.25);

    var itcBaseRate = toNumber(itc.baseRate, 0);
    var itcAdders = toNumber(itc.adders, 0);
    var itcRate = itcBaseRate + itcAdders;
    var fmv = toNumber(itc.fmv, unleveredCapex);
    var fmvStepUp = toNumber(itc.fmvStepUp, 1);
    var steppedBasis = fmv * fmvStepUp;
    var itcAmount = steppedBasis * itcRate;

    var discountRate = toNumber(asset.discountRate, DEFAULT_DISCOUNT_RATE);

    var debtServiceFixed = annuityPayment(loanSize, interestRate, tenorYears);
    var years = [];
    var debtBalance = loanSize;

    var equityAtCOD = unleveredCapex - loanSize - itcAmount;
    var equityCashflows = [-equityAtCOD];

    for (var y = 1; y <= MODEL_YEARS; y += 1) {
      var active = y <= assetLifeYears;
      var degradationFactor = active ? Math.pow(1 - degradation, y - 1) : 0;
      var netMWh = active
        ? mwdc * 1000 * yieldKwhPerKwp * availability * degradationFactor * (1 - curtailment) / 1000
        : 0;

      var isPpa = y <= ppaEndYear;
      var ppaPriceYear = ppaPrice * Math.pow(1 + ppaEsc, y - 1);
      var merchantPriceYear = merchantPrice * Math.pow(1 + merchantEsc, Math.max(0, y - ppaEndYear - 1));
      var realizedPrice = isPpa ? ppaPriceYear : merchantPriceYear;
      var revenueYear = active ? netMWh * realizedPrice : 0;

      var opexYear = 0;
      var opexByLine = {};
      for (var i = 0; i < opexLines.length; i += 1) {
        var line = opexLines[i];
        var value = active ? line.year1 * Math.pow(1 + line.escalation, y - 1) : 0;
        opexByLine[line.name] = value;
        opexYear += value;
      }

      var ebitda = revenueYear - opexYear;
      var interest = y <= tenorYears ? debtBalance * interestRate : 0;
      var scheduledDebtService = y <= tenorYears ? debtServiceFixed : 0;
      var principal = y <= tenorYears ? Math.max(0, scheduledDebtService - interest) : 0;
      principal = Math.min(principal, debtBalance);
      var debtService = interest + principal;
      var endingDebtBalance = Math.max(0, debtBalance - principal);

      var cfads = ebitda;
      var cashAfterDebt = cfads - debtService;
      var dscr = debtService > 0 ? cfads / debtService : null;
      var covenantBreached = dscr !== null ? dscr < dscrCovenant : false;

      years.push({
        year: y,
        operational: active,
        netGenerationMWh: netMWh,
        realizedPricePerMWh: realizedPrice,
        revenue: revenueYear,
        opexByLine: opexByLine,
        totalOpex: opexYear,
        ebitda: ebitda,
        debtBeginningBalance: debtBalance,
        interestExpense: interest,
        principalRepayment: principal,
        debtService: debtService,
        debtEndingBalance: endingDebtBalance,
        cfads: cfads,
        cashAfterDebtService: cashAfterDebt,
        dscr: dscr,
        dscrCovenantBreached: covenantBreached
      });

      equityCashflows.push(cashAfterDebt);
      debtBalance = endingDebtBalance;
    }

    var realIrr = irrNewtonRaphson(equityCashflows, 0.12);
    var equityNpv = npv(discountRate, equityCashflows);
    var minDscr = null;
    for (var j = 0; j < years.length; j += 1) {
      if (years[j].dscr !== null) {
        minDscr = minDscr === null ? years[j].dscr : Math.min(minDscr, years[j].dscr);
      }
    }

    var loanLifeCfads = years.slice(0, tenorYears).map(function (r) { return r.cfads; });
    var llcrNumerator = 0;
    for (var k = 0; k < loanLifeCfads.length; k += 1) {
      llcrNumerator += loanLifeCfads[k] / Math.pow(1 + discountRate, k + 1);
    }
    var llcr = loanSize > 0 ? llcrNumerator / loanSize : null;

    var totalDistributions = sum(equityCashflows.slice(1));
    var moic = equityAtCOD !== 0 ? totalDistributions / Math.abs(equityAtCOD) : null;

    var cumulative = equityCashflows[0];
    var paybackYear = null;
    for (var p = 1; p < equityCashflows.length; p += 1) {
      cumulative += equityCashflows[p];
      if (paybackYear === null && cumulative >= 0) paybackYear = p;
    }

    return {
      assetId: asset.id,
      assetName: asset.name,
      assumptions: asset,
      years: years,
      cashflows: {
        equity: equityCashflows,
        equityAtCOD: equityAtCOD,
        itcAmount: itcAmount
      },
      metrics: {
        irr: realIrr,
        npv: equityNpv,
        llcr: llcr,
        moic: moic,
        paybackYear: paybackYear,
        minDscr: minDscr,
        totalRevenue: sum(years.map(function (r) { return r.revenue; })),
        totalOpex: sum(years.map(function (r) { return r.totalOpex; })),
        totalEbitda: sum(years.map(function (r) { return r.ebitda; }))
      }
    };
  }

  function calcPortfolio(portfolio) {
    var assets = Array.isArray(portfolio.assets) ? portfolio.assets : [];
    var discountRate = toNumber(portfolio.discountRate, DEFAULT_DISCOUNT_RATE);
    var perAsset = [];

    var blendedCashflows = [0];
    var totalCapex = 0;
    var totalDebt = 0;
    var totalItc = 0;

    for (var i = 0; i < assets.length; i += 1) {
      var modeled = calcAsset(assets[i]);
      perAsset.push({
        id: assets[i].id,
        name: assets[i].name,
        region: assets[i].region,
        metrics: modeled.metrics
      });

      totalCapex += sum(assets[i].capex.lines.map(function (l) { return toNumber(l.amount, 0); }));
      totalDebt += toNumber(assets[i].debt.loanSize, 0);
      totalItc += modeled.cashflows.itcAmount;

      var eq = modeled.cashflows.equity;
      for (var y = 0; y < eq.length; y += 1) {
        blendedCashflows[y] = toNumber(blendedCashflows[y], 0) + eq[y];
      }
    }

    var blendedIrr = irrNewtonRaphson(blendedCashflows, 0.1);
    var blendedNpv = npv(discountRate, blendedCashflows);

    return {
      portfolioName: portfolio.name,
      discountRate: discountRate,
      summaryByAsset: perAsset,
      blended: {
        equityCashflows: blendedCashflows,
        irr: blendedIrr,
        npv: blendedNpv,
        totalUnleveredCapex: totalCapex,
        totalDebt: totalDebt,
        totalItc: totalItc,
        totalEquity: totalCapex - totalDebt - totalItc
      }
    };
  }

  function defaultOpexLines(scale) {
    return [
      { name: "PV O&M", year1: 479 * scale, escalation: 0.02 },
      { name: "Utility O&M", year1: 68 * scale, escalation: 0.0 },
      { name: "Parasitic Load", year1: 60 * scale, escalation: 0.01 },
      { name: "Uncovered O&M", year1: 70 * scale, escalation: 0.02 },
      { name: "Telecom", year1: 34 * scale, escalation: 0.02 },
      { name: "Insurance", year1: 321 * scale, escalation: 0.02 },
      { name: "Asset Management", year1: 70 * scale, escalation: 0.02 },
      { name: "Audit & Tax", year1: 19 * scale, escalation: 0.02 },
      { name: "LC / Financing Fees", year1: 113 * scale, escalation: 0.0 },
      { name: "Inverter Reserve", year1: 0 * scale, escalation: 0.0 },
      { name: "Other OPEX", year1: 117 * scale, escalation: 0.01 },
      { name: "Land Lease", year1: 582 * scale, escalation: 0.02 }
    ];
  }

  var portfolio = {
    name: "SolarLedger Institutional Portfolio",
    discountRate: 0.08,
    assets: [
      {
        id: "yarotek",
        name: "Yarotek",
        region: "Duke NC",
        technical: {
          mwdc: 82,
          yieldKwhPerKwp: 1710,
          dcAcRatio: 1.43,
          availability: 0.985,
          degradation: 0.004,
          cod: "2030-06-30",
          assetLifeYears: 35
        },
        revenue: {
          ppaPricePerMWh: 59,
          ppaEscalation: 0.0,
          ppaEndYear: 5,
          merchantPricePerMWh: 65,
          merchantEscalation: 0.015,
          curtailment: 0.02
        },
        opex: {
          lines: defaultOpexLines(1)
        },
        capex: {
          lines: [
            { name: "Modules", amount: 34440 },
            { name: "Field & DC", amount: 31245 },
            { name: "General & Administrative", amount: 11165 },
            { name: "Substation / MV", amount: 7038 },
            { name: "Interconnection", amount: 3080 },
            { name: "Contingency", amount: 3130 },
            { name: "Financing Fees & IDC", amount: 6000 }
          ]
        },
        debt: {
          loanSize: 27500,
          interestRate: 0.085,
          tenorYears: 20,
          dscrCovenant: 1.25,
          benchmark: "SOFR+2.5%"
        },
        itc: {
          baseRate: 0.30,
          adders: 0.10,
          fmv: 142545,
          fmvStepUp: 1.0
        }
      },
      {
        id: "project-iguana",
        name: "Project Iguana",
        region: "ERCOT",
        technical: {
          mwdc: 50,
          yieldKwhPerKwp: 1780,
          dcAcRatio: 1.35,
          availability: 0.985,
          degradation: 0.0045,
          cod: "2031-03-31",
          assetLifeYears: 35
        },
        revenue: {
          ppaPricePerMWh: 52,
          ppaEscalation: 0.01,
          ppaEndYear: 10,
          merchantPricePerMWh: 58,
          merchantEscalation: 0.02,
          curtailment: 0.03
        },
        opex: {
          lines: defaultOpexLines(50 / 82)
        },
        capex: {
          lines: [
            { name: "Modules", amount: 21500 },
            { name: "Field & DC", amount: 19200 },
            { name: "General & Administrative", amount: 7200 },
            { name: "Substation / MV", amount: 4700 },
            { name: "Interconnection", amount: 2200 },
            { name: "Contingency", amount: 2100 },
            { name: "Financing Fees & IDC", amount: 3900 }
          ]
        },
        debt: {
          loanSize: 18000,
          interestRate: 0.0825,
          tenorYears: 18,
          dscrCovenant: 1.25,
          benchmark: "Placeholder debt"
        },
        itc: {
          baseRate: 0.30,
          adders: 0.00,
          fmv: 87000,
          fmvStepUp: 1.0
        }
      },
      {
        id: "bengal",
        name: "Bengal",
        region: "PJM",
        technical: {
          mwdc: 35,
          yieldKwhPerKwp: 1650,
          dcAcRatio: 1.30,
          availability: 0.984,
          degradation: 0.0045,
          cod: "2031-09-30",
          assetLifeYears: 35
        },
        revenue: {
          ppaPricePerMWh: 55,
          ppaEscalation: 0.005,
          ppaEndYear: 7,
          merchantPricePerMWh: 62,
          merchantEscalation: 0.018,
          curtailment: 0.02
        },
        opex: {
          lines: defaultOpexLines(35 / 82)
        },
        capex: {
          lines: [
            { name: "Modules", amount: 15200 },
            { name: "Field & DC", amount: 13400 },
            { name: "General & Administrative", amount: 5200 },
            { name: "Substation / MV", amount: 3100 },
            { name: "Interconnection", amount: 1500 },
            { name: "Contingency", amount: 1500 },
            { name: "Financing Fees & IDC", amount: 2500 }
          ]
        },
        debt: {
          loanSize: 12000,
          interestRate: 0.085,
          tenorYears: 18,
          dscrCovenant: 1.25,
          benchmark: "Placeholder debt"
        },
        itc: {
          baseRate: 0.30,
          adders: 0.10,
          fmv: 62000,
          fmvStepUp: 1.0
        }
      }
    ]
  };

  var activeAsset = portfolio.assets[0].id;

  window.SolarLedger = {
    portfolio: portfolio,
    calcAsset: calcAsset,
    calcPortfolio: calcPortfolio,
    activeAsset: activeAsset,
    round: round
  };
})();
