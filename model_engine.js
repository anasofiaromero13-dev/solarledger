(function () {
  "use strict";

  function toNumber(value, fallback) {
    var n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function npvCalc(rate, cashFlows) {
    var total = 0;
    for (var i = 0; i < cashFlows.length; i += 1) {
      total += cashFlows[i] / Math.pow(1 + rate, i);
    }
    return total;
  }

  function calcIRR(cashFlows) {
    var guess = 0.10;
    for (var iter = 0; iter < 100; iter += 1) {
      var npvVal = npvCalc(guess, cashFlows);
      var npvDerivative = 0;
      for (var i = 1; i < cashFlows.length; i += 1) {
        npvDerivative += -i * cashFlows[i] / Math.pow(1 + guess, i + 1);
      }
      if (Math.abs(npvDerivative) < 1e-12) break;
      var newGuess = guess - npvVal / npvDerivative;
      if (!Number.isFinite(newGuess) || newGuess <= -0.9999) break;
      if (Math.abs(newGuess - guess) < 0.0000001) {
        guess = newGuess;
        break;
      }
      guess = newGuess;
    }
    return guess;
  }

  function calcAsset(asset) {
    var inputs = asset.inputs || asset;
    var assetLife = Math.max(1, Math.floor(toNumber(inputs.assetLife, 35)));
    var loanTenor = Math.max(0, Math.floor(toNumber(inputs.loanTenor, 0)));

    var yearly = [];
    var debtOutstanding = [];
    var leveredCashFlows = [];
    var cfadsForNpv = [];

    var itcProceeds = toNumber(inputs.fmv, 0) * toNumber(inputs.itcRate, 0);
    var sponsorEquity =
      toNumber(inputs.totalUnleveredCapex, 0) +
      toNumber(inputs.financingIDC, 0) -
      toNumber(inputs.loanAmount, 0) -
      itcProceeds -
      toNumber(inputs.preferredEquity, 0);

    leveredCashFlows.push(-sponsorEquity);

    for (var year = 1; year <= assetLife; year += 1) {
      // GENERATION
      var degradationFactor = Math.pow(1 - toNumber(inputs.annualDegradation, 0), year - 1);
      var grossMWh =
        toNumber(inputs.mwdc, 0) *
        toNumber(inputs.yieldKwhKwp, 0) *
        toNumber(inputs.availabilityFactor, 0) *
        degradationFactor;
      var netMWh = grossMWh * (1 - toNumber(inputs.curtailment, 0));

      // REVENUE
      var ppaPrice = null;
      var merchantPrice = null;
      var revenue = 0;
      if (inputs.revenueMode === "toll") {
        var tollBase = (toNumber(inputs.mwac, 0) * toNumber(inputs.tollPriceKwMonthYr1, 0) * 12000) / 1000;
        revenue = tollBase * Math.pow(1 + toNumber(inputs.tollEscalation, 0), year - 1);
      } else {
        if (year <= toNumber(inputs.ppaTenor, 0)) {
          ppaPrice = toNumber(inputs.ppaPriceYr1, 0) * Math.pow(1 + toNumber(inputs.ppaEscalation, 0), year - 1);
          revenue = netMWh * ppaPrice / 1000;
        } else {
          var yearsPostPPA = year - toNumber(inputs.ppaTenor, 0) - 1;
          merchantPrice = toNumber(inputs.merchantPriceYr1, 0) * Math.pow(1 + toNumber(inputs.merchantEscalation, 0), yearsPostPPA);
          revenue = netMWh * merchantPrice / 1000;
        }
      }

      // OPEX
      var opexKeys = [
        "pvo",
        "utilityOM",
        "parasiticLoad",
        "uncoveredOM",
        "telecom",
        "insurance",
        "assetMgmt",
        "auditTax",
        "lcFees",
        "otherOpex",
        "operatingLease"
      ];
      var opexByLine = {};
      var totalOpex = 0;

      for (var i = 0; i < opexKeys.length; i += 1) {
        var key = opexKeys[i];
        var yr1Cost = toNumber((inputs.opex || {})[key], 0);
        var escalationRate = toNumber((inputs.opexEscalation || {})[key], 0);
        var lineValue = yr1Cost * Math.pow(1 + escalationRate, year - 1);
        opexByLine[key] = lineValue;
        totalOpex += lineValue;
      }

      var reserve = inputs.inverterReserve || {};
      var inverterReserveCost = 0;
      if (
        year >= toNumber(reserve.startYear, 0) &&
        year <= toNumber(reserve.endYear, 0)
      ) {
        inverterReserveCost = toNumber(reserve.annualCost, 0);
      }
      opexByLine.inverterReserve = inverterReserveCost;
      totalOpex += inverterReserveCost;

      // EBITDA
      var ebitda = revenue - totalOpex;
      var ebitdaMargin = revenue !== 0 ? ebitda / revenue : null;

      // DEBT SCHEDULE
      var beginningBalance = year === 1
        ? toNumber(inputs.loanAmount, 0)
        : debtOutstanding[year - 2] - yearly[year - 2].amortization;
      if (beginningBalance < 0) beginningBalance = 0;

      var amortization = year <= loanTenor
        ? toNumber(inputs.loanAmount, 0) / loanTenor
        : 0;
      amortization = Math.min(amortization, beginningBalance);

      var interest = beginningBalance * toNumber(inputs.interestRate, 0);
      var totalDebtService = amortization + interest;
      var cfads = ebitda - totalDebtService;
      var dscr = totalDebtService > 0 ? ebitda / totalDebtService : null;

      debtOutstanding.push(beginningBalance);
      cfadsForNpv.push(cfads);
      leveredCashFlows.push(cfads);

      yearly.push({
        year: year,
        degradationFactor: degradationFactor,
        grossMWh: grossMWh,
        netMWh: netMWh,
        ppaPrice: ppaPrice,
        merchantPrice: merchantPrice,
        revenue: revenue,
        opexByLine: opexByLine,
        totalOpex: totalOpex,
        ebitda: ebitda,
        ebitdaMargin: ebitdaMargin,
        beginningBalance: beginningBalance,
        amortization: amortization,
        interest: interest,
        totalDebtService: totalDebtService,
        cfads: cfads,
        dscr: dscr
      });
    }

    // IRR
    var irr = calcIRR(leveredCashFlows);

    // NPV
    var discountRate = toNumber(inputs.discountRate, 0);
    var npv = 0;
    for (var n = 1; n <= assetLife; n += 1) {
      npv += cfadsForNpv[n - 1] / Math.pow(1 + discountRate, n);
    }

    // LLCR at year 1
    var npvCfadsLoanLife = 0;
    var loanLifeYears = Math.min(loanTenor, assetLife);
    for (var l = 1; l <= loanLifeYears; l += 1) {
      npvCfadsLoanLife += cfadsForNpv[l - 1] / Math.pow(1 + discountRate, l);
    }
    var outstandingDebt = toNumber(inputs.loanAmount, 0);
    var llcr = outstandingDebt > 0 ? npvCfadsLoanLife / outstandingDebt : null;

    // MOIC
    var totalEquityReturned = 0;
    for (var c = 1; c < leveredCashFlows.length; c += 1) {
      if (leveredCashFlows[c] > 0) totalEquityReturned += leveredCashFlows[c];
    }
    var moic = sponsorEquity !== 0 ? totalEquityReturned / sponsorEquity : null;

    // PAYBACK
    var cumulativeCfads = 0;
    var paybackYear = null;
    for (var p = 0; p < cfadsForNpv.length; p += 1) {
      cumulativeCfads += cfadsForNpv[p];
      if (paybackYear === null && cumulativeCfads > sponsorEquity) {
        paybackYear = p + 1;
      }
    }

    // MIN DSCR
    var minDscr = null;
    for (var d = 0; d < yearly.length; d += 1) {
      var y = yearly[d];
      if (y.beginningBalance > 0 && y.dscr !== null) {
        minDscr = minDscr === null ? y.dscr : Math.min(minDscr, y.dscr);
      }
    }

    return {
      name: asset.name || "asset",
      inputs: inputs,
      itcProceeds: itcProceeds,
      sponsorEquity: sponsorEquity,
      leveredCashFlows: leveredCashFlows,
      yearly: yearly,
      metrics: {
        irr: irr,
        npv: npv,
        llcr: llcr,
        moic: moic,
        paybackYear: paybackYear,
        minDscr: minDscr
      }
    };
  }

  var assets = {
    yarotek: {
      name: "Yarotek Portfolio",
      type: "Utility-Scale Development",
      market: "Duke NC",
      badgeColor: "blue",
      inputs: {
        mwdc: 82,
        yieldKwhKwp: 1710,
        dcAcRatio: 1.43,
        availabilityFactor: 0.985,
        annualDegradation: 0.004,
        curtailment: 0.02,
        assetLife: 35,
        codYear: 2030,

        ppaPriceYr1: 59,
        ppaEscalation: 0.0,
        ppaTenor: 5,
        merchantPriceYr1: 65,
        merchantEscalation: 0.015,

        opex: {
          pvo: 479,
          utilityOM: 68,
          parasiticLoad: 60,
          uncoveredOM: 70,
          telecom: 34,
          insurance: 321,
          assetMgmt: 70,
          auditTax: 19,
          lcFees: 113,
          otherOpex: 117,
          operatingLease: 582
        },
        opexEscalation: {
          pvo: 0.02,
          utilityOM: 0.0,
          parasiticLoad: 0.01,
          uncoveredOM: 0.02,
          telecom: 0.02,
          insurance: 0.0,
          assetMgmt: 0.02,
          auditTax: 0.02,
          lcFees: 0.0,
          otherOpex: 0.0,
          operatingLease: 0.02
        },
        inverterReserve: {
          startYear: 16,
          endYear: 20,
          annualCost: 250
        },

        totalUnleveredCapex: 110432,
        financingIDC: 6000,
        loanAmount: 27500,
        interestRate: 0.085,
        loanTenor: 20,
        itcRate: 0.40,
        fmv: 142545,
        preferredEquity: 17132,
        discountRate: 0.08
      }
    },
    dgbess: {
      name: "DG BESS NY",
      type: "Battery Storage",
      market: "NYISO",
      badgeColor: "teal",
      inputs: {
        mwdc: 0,
        mwac: 5,
        mwh: 20,
        yieldKwhKwp: 0,
        dcAcRatio: 1,
        availabilityFactor: 1,
        annualDegradation: 0,
        curtailment: 0,
        assetLife: 30,
        codYear: 2029,
        revenueMode: "toll",
        tollPriceKwMonthYr1: 12,
        tollEscalation: 0.015,
        ppaPriceYr1: 0,
        ppaEscalation: 0,
        ppaTenor: 15,
        merchantPriceYr1: 0,
        merchantEscalation: 0,
        opex: {
          pvo: 20,
          utilityOM: 0,
          parasiticLoad: 0,
          uncoveredOM: 12,
          telecom: 6,
          insurance: 30,
          assetMgmt: 22,
          auditTax: 4,
          lcFees: 0,
          otherOpex: 8,
          operatingLease: 0
        },
        opexEscalation: {
          pvo: 0.02,
          utilityOM: 0.02,
          parasiticLoad: 0.02,
          uncoveredOM: 0.02,
          telecom: 0.02,
          insurance: 0.03,
          assetMgmt: 0.02,
          auditTax: 0.02,
          lcFees: 0.02,
          otherOpex: 0.02,
          operatingLease: 0.02
        },
        inverterReserve: { startYear: 1, endYear: 0, annualCost: 0 },
        totalUnleveredCapex: 11148,
        financingIDC: 0,
        loanAmount: 4470,
        interestRate: 0.105,
        loanTenor: 7,
        itcRate: 0.40,
        fmv: 13500,
        preferredEquity: 1885,
        discountRate: 0.08
      }
    },
    foley: {
      name: "Foley (Alabama)",
      type: "Operating Asset Acquisition",
      market: "Alabama",
      badgeColor: "amber",
      inputs: {
        mwdc: 106.1,
        yieldKwhKwp: 1906,
        dcAcRatio: 1.3,
        availabilityFactor: 0.98,
        annualDegradation: 0.0045,
        curtailment: 0,
        assetLife: 40,
        codYear: 2026,
        ppaPriceYr1: 50,
        ppaEscalation: 0,
        ppaTenor: 17,
        merchantPriceYr1: 45,
        merchantEscalation: 0.02,
        opex: {
          pvo: 583,
          utilityOM: 0,
          parasiticLoad: 77,
          uncoveredOM: 85,
          telecom: 44,
          insurance: 415,
          assetMgmt: 85,
          auditTax: 24,
          lcFees: 96,
          otherOpex: 50,
          operatingLease: 0
        },
        opexEscalation: {
          pvo: 0.02,
          utilityOM: 0.02,
          parasiticLoad: 0.02,
          uncoveredOM: 0.02,
          telecom: 0.02,
          insurance: 0.03,
          assetMgmt: 0.02,
          auditTax: 0.02,
          lcFees: 0.02,
          otherOpex: 0.02,
          operatingLease: 0.02
        },
        inverterReserve: { startYear: 1, endYear: 0, annualCost: 0 },
        totalUnleveredCapex: 160734,
        financingIDC: 7036,
        loanAmount: 85000,
        interestRate: 0.075,
        loanTenor: 20,
        itcRate: 0,
        fmv: 206690,
        preferredEquity: 0,
        discountRate: 0.08
      }
    },
    bsu: {
      name: "BSU Operating Portfolio",
      type: "C&I Operating Portfolio",
      market: "Northeast US",
      badgeColor: "green",
      inputs: {
        mwdc: 14,
        yieldKwhKwp: 1450,
        dcAcRatio: 1.15,
        availabilityFactor: 0.99,
        annualDegradation: 0.005,
        curtailment: 0,
        assetLife: 30,
        codYear: 2023,
        ppaPriceYr1: 172,
        ppaEscalation: 0.04,
        ppaTenor: 25,
        merchantPriceYr1: 120,
        merchantEscalation: 0.02,
        opex: {
          pvo: 81,
          utilityOM: 0,
          parasiticLoad: 0,
          uncoveredOM: 11,
          telecom: 8,
          insurance: 42,
          assetMgmt: 34,
          auditTax: 5,
          lcFees: 0,
          otherOpex: 12,
          operatingLease: 48
        },
        opexEscalation: {
          pvo: 0.02,
          utilityOM: 0.02,
          parasiticLoad: 0.02,
          uncoveredOM: 0.02,
          telecom: 0.02,
          insurance: 0.05,
          assetMgmt: 0.02,
          auditTax: 0.02,
          lcFees: 0.02,
          otherOpex: 0.02,
          operatingLease: 0.04
        },
        inverterReserve: { startYear: 1, endYear: 0, annualCost: 0 },
        totalUnleveredCapex: 28000,
        financingIDC: 0,
        loanAmount: 12000,
        interestRate: 0.065,
        loanTenor: 15,
        itcRate: 0.26,
        fmv: 35000,
        preferredEquity: 0,
        discountRate: 0.08
      }
    }
  };

  var activeAsset = "yarotek";

  window.SolarLedger = {
    assets: assets,
    calcAsset: calcAsset,
    activeAsset: activeAsset
  };
})();
