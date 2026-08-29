/**
 * 日本の国民の祝日を計算する。
 * ハッピーマンデー・振替休日・国民の休日（祝日に挟まれた平日）に対応。
 * 春分の日・秋分の日は近似式で算出するため将来年で数日ずれる可能性がある。
 */
(function (global) {
  'use strict';

  function nthMonday(year, month, nth) {
    var d = new Date(year, month - 1, 1);
    var offset = (8 - d.getDay()) % 7; // days until first Monday
    var day = 1 + offset + (nth - 1) * 7;
    return new Date(year, month - 1, day);
  }

  function vernalEquinoxDay(year) {
    var day = Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
    return new Date(year, 2, day); // March
  }

  function autumnalEquinoxDay(year) {
    var day = Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
    return new Date(year, 8, day); // September
  }

  function fmt(date) {
    var y = date.getFullYear();
    var m = String(date.getMonth() + 1).padStart(2, '0');
    var d = String(date.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
  }

  function baseHolidays(year) {
    var list = [];
    function add(date, name) {
      if (date.getFullYear() === year) list.push({ date: date, name: name });
    }

    add(new Date(year, 0, 1), '元日');
    add(nthMonday(year, 1, 2), '成人の日');
    add(new Date(year, 1, 11), '建国記念の日');
    if (year >= 2020) add(new Date(year, 1, 23), '天皇誕生日');
    add(vernalEquinoxDay(year), '春分の日');
    add(new Date(year, 3, 29), '昭和の日');
    add(new Date(year, 4, 3), '憲法記念日');
    add(new Date(year, 4, 4), 'みどりの日');
    add(new Date(year, 4, 5), 'こどもの日');
    add(year >= 2021 ? nthMonday(year, 7, 3) : nthMonday(year, 7, 3), '海の日');
    if (year >= 2016) add(new Date(year, 7, 11), '山の日');
    add(nthMonday(year, 9, 3), '敬老の日');
    add(autumnalEquinoxDay(year), '秋分の日');
    add(nthMonday(year, 10, 2), 'スポーツの日');
    add(new Date(year, 10, 3), '文化の日');
    add(new Date(year, 10, 23), '勤労感謝の日');
    if (year < 2019) add(new Date(year, 11, 23), '天皇誕生日');

    // 2020年 東京五輪特例（海の日・スポーツの日・山の日移動）は簡略化のため考慮しない
    return list;
  }

  function computeHolidays(year) {
    var list = baseHolidays(year - 1)
      .concat(baseHolidays(year))
      .concat(baseHolidays(year + 1));

    var map = {};
    list.forEach(function (h) {
      map[fmt(h.date)] = h.name;
    });

    // 振替休日: 日曜が祝日の場合、直後の最初の平日（祝日でない日）を振替休日とする
    list.forEach(function (h) {
      if (h.date.getDay() === 0) {
        var d = new Date(h.date);
        do {
          d.setDate(d.getDate() + 1);
        } while (map[fmt(d)]);
        map[fmt(d)] = '振替休日';
      }
    });

    // 国民の休日: 前後を祝日に挟まれた平日
    var allDates = Object.keys(map);
    allDates.forEach(function (key) {
      var d = new Date(key);
      var mid = new Date(d);
      mid.setDate(mid.getDate() + 1);
      var midKey = fmt(mid);
      var after = new Date(d);
      after.setDate(after.getDate() + 2);
      var afterKey = fmt(after);
      if (map[key] && map[afterKey] && !map[midKey] && mid.getDay() !== 0) {
        map[midKey] = '国民の休日';
      }
    });

    return map; // { 'YYYY-MM-DD': name }
  }

  var cache = {};
  function getHolidayMap(year) {
    if (!cache[year]) cache[year] = computeHolidays(year);
    return cache[year];
  }

  function getHolidayName(date) {
    var map = getHolidayMap(date.getFullYear());
    return map[fmt(date)] || null;
  }

  global.JPHolidays = {
    getHolidayName: getHolidayName,
    getHolidayMap: getHolidayMap
  };
})(window);
