// Modelo de puntuación compartido: el mismo código puntúa los candidatos al generarlos
// y explica la puntuación en la ficha de la app.
// f: rasgos del sitio (distancias en metros, -1 = no hay nada cerca)
//   dw agua, dv Vía de la Plata, dp vía pecuaria / camino histórico, vd vado (cruce camino-arroyo)
//   tn/td topónimo y distancia, ts fuerza del topónimo (2 fuerte, 1 medio)
//   en/ed ermita fuera del pueblo, kn/kd sitio conocido, sp manantial
//   sl pendiente %, tp posición relativa (m sobre el entorno de 1 km), dt distancia a pueblo actual
//   an anomalía LiDAR: {sg:+1 montículo/-1 hoyo, h altura m, ar área m2, el alargamiento, sig nitidez}
var ARQ = (function () {
  function contrib(f) {
    var w = [];
    var add = function (t, p) { if (p) w.push([t, p]); };
    // agua: los asentamientos antiguos casi siempre están a pocos cientos de metros de agua
    if (f.dw >= 0) {
      if (f.dw < 80) add('Pegado al arroyo (' + f.dw + ' m): agua, pero zona inundable', 4);
      else if (f.dw <= 700) add('Agua a ' + f.dw + ' m: distancia típica de villas y poblados', 16);
      else if (f.dw <= 1500) add('Agua a ' + f.dw + ' m', 9);
      else if (f.dw <= 3000) add('Agua algo lejos (' + (f.dw / 1000).toFixed(1) + ' km)', 3);
    }
    // calzada principal
    if (f.dv >= 0) {
      if (f.dv <= 500) add('A ' + f.dv + ' m del eje de la Vía de la Plata', 16);
      else if (f.dv <= 1500) add('A ' + (f.dv / 1000).toFixed(1) + ' km de la Vía de la Plata', 11);
      else if (f.dv <= 3000) add('Zona de influencia de la Vía de la Plata (' + (f.dv / 1000).toFixed(1) + ' km)', 5);
    }
    // vías pecuarias y caminos viejos (muchos siguen trazados antiguos)
    if (f.dp >= 0) {
      if (f.dp <= 300) add('Junto a cañada o camino histórico (' + f.dp + ' m)', 8);
      else if (f.dp <= 1000) add('Cerca de cañada o camino histórico (' + f.dp + ' m)', 4);
    }
    if (f.vd >= 0 && f.vd <= 1000) add('Cerca de un vado: un camino histórico cruza el agua a ' + f.vd + ' m', 7);
    // toponimia
    if (f.td >= 0) {
      if (f.ts === 2) add('Topónimo revelador «' + f.tn + '» a ' + f.td + ' m', f.td <= 500 ? 18 : 10);
      else if (f.ts === 1) add('Topónimo con posible pista «' + f.tn + '» a ' + f.td + ' m', f.td <= 500 ? 7 : 3);
    }
    if (f.ed >= 0 && f.ed <= 350) add('Ermita en el campo («' + f.en + '») a ' + f.ed + ' m: muchas se levantaron sobre ruinas antiguas', 12);
    if (f.kd >= 0 && f.kd <= 1500) add('A ' + (f.kd / 1000).toFixed(1) + ' km de un sitio conocido («' + f.kn + '»): los yacimientos se agrupan', 6);
    if (f.sp >= 0 && f.sp <= 500) add('Fuente o manantial a ' + f.sp + ' m', 5);
    // terreno
    if (f.sl >= 0) {
      if (f.sl < 4) add('Terreno llano (' + f.sl + ' %): bueno para edificar y cultivar', 6);
      else if (f.sl < 10) add('Pendiente suave (' + f.sl + ' %)', 3);
      else if (f.sl > 20) add('Ladera fuerte (' + f.sl + ' %)', -6);
    }
    if (f.tp > 3 && f.tp <= 25) add('Ligeramente elevado sobre su entorno (+' + f.tp + ' m): domina sin estar expuesto', 6);
    else if (f.tp > 25) add('Cerro dominante (+' + f.tp + ' m sobre el entorno): típico de poblados en altura', 8);
    if (f.dt >= 0 && f.dt < 700) add('Cerca de un pueblo actual (' + f.dt + ' m): más alterado', -4);
    // LiDAR
    var a = f.an;
    if (a) {
      if (a.sg > 0) {
        var p = 8;
        if (a.h >= 0.4 && a.h <= 3.5) p += 8;
        if (a.ar >= 300 && a.ar <= 12000) p += 6;
        if (a.el <= 1.8) p += 4;
        p += Math.max(0, Math.min(8, Math.round((a.sig - 1) * 3)));
        add('Abultamiento en el relieve LiDAR: ' + a.h.toFixed(1) + ' m de alto, ' + fmtA(a.ar) + (a.el <= 1.8 ? ', forma compacta' : ''), p);
      } else {
        var q = 5 + Math.max(0, Math.min(6, Math.round((a.sig - 1) * 2)));
        add('Hundimiento en el relieve LiDAR: ' + a.h.toFixed(1) + ' m, ' + fmtA(a.ar), q);
      }
    }
    // satélite (Landsat, veranos 2013-2025): humedad o frescor persistente
    if (f.sat) {
      if (f.sat.mA <= -1 && f.sat.aN >= 0.03) add('En verano el sitio sale más fresco y verde que su entorno, año tras año (satélite): humedad bajo tierra', 5);
      else if (f.sat.aN >= 0.05) add('Mancha verde persistente en los veranos secos (satélite)', 3);
    }
    // control de calidad de la auditoría
    if (f.qc) {
      if (f.qc & 1) add('Control: hay agua embalsada en el punto (probable charca o balsa moderna)', -15);
      if (f.qc & 2) add('Control: edificios o naves junto al punto', -12);
      if (f.qc & 4) add('Control: pegado a una carretera o camino con taludes', -8);
    }
    return w;
  }
  function fmtA(m2) { return m2 >= 10000 ? (m2 / 10000).toFixed(1) + ' ha' : Math.round(m2) + ' m²'; }
  function score(f) {
    var s = 0, w = contrib(f);
    for (var i = 0; i < w.length; i++) s += w[i][1];
    return Math.max(0, Math.min(100, Math.round(s)));
  }
  // Teoría de qué puede ser, según los rasgos
  function theory(f) {
    var a = f.an, T = [];
    if (a && a.sg > 0 && a.ar < 2500 && a.el <= 1.8 && a.h >= 0.5)
      T.push(['Túmulo o montículo artificial', 'Un abultamiento redondeado y pequeño en terreno llano suele ser un túmulo funerario (dolmen cubierto de tierra, Neolítico–Edad del Bronce) o los escombros de una construcción aislada: una torre, un horno o una casa de labor antigua.']);
    if (a && a.sg > 0 && a.ar >= 2500 && a.h <= 4)
      T.push(['Plataforma de villa romana o asentamiento rural', 'Una meseta baja y ancha aparece cuando muros, tejas y suelos se derrumban y el arado los extiende: el terreno queda unos palmos más alto. Es la huella típica de las villas romanas de Tierra de Barros.']);
    if (f.tp > 25 || (a && a.sg > 0 && a.h > 4))
      T.push(['Poblado en altura (castro u oppidum)', 'Los cerros que dominan el entorno, con agua cerca, se ocuparon en la Edad del Bronce y del Hierro y en época islámica por defensa. Busca en la ladera terrazas, muros o un foso.']);
    if (a && a.sg < 0)
      T.push(['Foso, silo o balsa antigua', 'Un hoyo cerrado puede ser un foso de recinto, una balsa o cantera antigua o un silo hundido. Muchos son charcas o extracciones modernas: compara con el vuelo de 1956.']);
    if (f.dv >= 0 && f.dv <= 1500 && f.dw >= 0 && f.dw <= 1500)
      T.push(['Mansio, venta o villa junto a la calzada', 'Junto a la Vía de la Plata, con agua cerca, se levantaban postas, ventas y villas que vendían a los viajeros. La mansio Perceiana se sitúa en el término de Villafranca.']);
    if ((f.dv >= 0 && f.dv <= 400) || (f.dp >= 0 && f.dp <= 200))
      T.push(['Necrópolis junto al camino', 'Los romanos enterraban a sus muertos a lo largo de los caminos, a la salida de villas y poblados. Fíjate en losas, ladrillos grandes o tejas planas juntas.']);
    if (f.ed >= 0 && f.ed <= 350)
      T.push(['Ermita sobre un lugar antiguo', 'Muchas ermitas rurales de Extremadura se construyeron con piedras de una villa romana o sobre una basílica tardoantigua. Mira sillares reaprovechados en los muros.']);
    if (f.td >= 0 && f.td <= 1200 && f.ts === 2)
      T.push(['Lo que dice el topónimo', topoWhy(f.tn)]);
    if (f.vd >= 0 && f.vd <= 1000)
      T.push(['Paso de río o vado', 'Donde un camino antiguo cruzaba el arroyo solía haber un puente, un molino o un asentamiento que controlaba el paso.']);
    if (!T.length)
      T.push(['Asentamiento rural probable', 'El sitio reúne lo que buscaban los pobladores antiguos: agua cerca, tierra buena y llana y buena comunicación. Es una deducción del modelo, sin señal clara en el relieve.']);
    return T;
  }
  function topoWhy(n) {
    var s = (n || '').toLowerCase();
    if (/villar/.test(s)) return '«Villar» es el nombre popular de un poblado abandonado: casi siempre hay restos (a menudo romanos o medievales).';
    if (/castillej|castillo|castro/.test(s)) return '«Castillejo» o «castro» señalan restos de un recinto fortificado o de muros que la gente tomaba por un castillo.';
    if (/paredon|pared/.test(s)) return '«Paredones» o «paredes» indican muros antiguos que estuvieron en pie hasta hace poco.';
    if (/torre/.test(s)) return '«Torre» o «torrejón» suele marcar una torre medieval, una atalaya o una villa romana fortificada.';
    if (/tejar|teja/.test(s)) return '«Tejar» o «teja»: o un horno de tejas, o un sitio lleno de tejas antiguas en superficie, típico de villas romanas.';
    if (/moro|mora/.test(s)) return 'En la tradición popular «de los moros» se atribuye a cualquier ruina muy antigua: suele haber restos.';
    if (/romano/.test(s)) return '«Los Romanos» es un nombre puesto por la gente al encontrar restos romanos en el campo.';
    if (/calzada/.test(s)) return '«Calzada» recuerda el paso de una vía romana empedrada.';
    if (/atalaya/.test(s)) return '«Atalaya» marca un punto de vigilancia: torre o puesto defensivo.';
    if (/palacio|casas viejas|casar|malcasar/.test(s)) return 'Nombres como «palacio», «casas viejas» o «casar» recuerdan edificios importantes desaparecidos.';
    if (/cristianos|tesoro|horno|siete piedras|piedras/.test(s)) return 'Nombre ligado a leyendas, hallazgos o piedras trabajadas: merece una visita.';
    return 'El nombre del paraje apunta a construcciones o hallazgos antiguos.';
  }
  return { contrib: contrib, score: score, theory: theory };
})();

// Cuevas, simas, galerías y anomalías de satélite.
// g: {k tipo (0 hoyo cerrado, 1 cortado rocoso, 3 humedad estival, 4 punto frío), ar m², h m, el, carb (2 caliza aquí, 1 a <1 km),
//     kc nombre de cueva/mina conocida cerca, kct tipo, kd m, mA anomalía térmica (desv.), aN anomalía de verdor, lit litología, qc}
var ARQC = (function () {
  var KIND = ['Hoyo cerrado o hundimiento', 'Cortado rocoso', '', 'Humedad persistente en verano', 'Punto frío persistente en verano'];
  function fmtA(m2) { return m2 >= 10000 ? (m2 / 10000).toFixed(1) + ' ha' : Math.round(m2) + ' m²'; }
  function contrib(g) {
    var w = [], add = function (t, p) { if (p) w.push([t, p]); };
    if (g.carb === 2) add('La roca de aquí es caliza o mármol (mapa geológico IGME): la única roca de la zona donde el agua abre cuevas', 30);
    else if (g.carb === 1) add('Hay caliza o mármol a menos de 1 km (IGME)', g.k === 3 || g.k === 4 ? 10 : 15);
    else if (/PIZARRAS;CALIZAS|CALCOESQUISTOS/.test(g.lit || '')) add('Pizarras con capas calizas: cuevas pequeñas posibles', 10);
    if (g.k === 0) {
      add('Hoyo cerrado en el LiDAR: ' + g.h.toFixed(1) + ' m de hondo, ' + fmtA(g.ar), g.h >= 3 ? 20 : g.h >= 1 ? 14 : 7);
      if (g.el <= 1.5) add('Forma redonda, como las dolinas y los pozos hundidos', 10);
    }
    if (g.k === 1) add('Cortado de más de 35° en el LiDAR (' + fmtA(g.ar) + '): donde se abren bocas de cueva y abrigos', 18);
    if (g.k === 3) add('En los veranos de 2013 a 2025 este punto sale más fresco y más verde que lo de alrededor (Landsat): agua o hueco cerca de la superficie', 42);
    if (g.k === 4) add('En los veranos de 2013 a 2025 este punto sale bastante más fresco que lo de alrededor, sin vegetación que lo explique (Landsat)', 36);
    if (g.kc && g.kd <= 1500) add((g.kct === 'cueva' ? 'Cueva o topónimo de cueva' : 'Mina o topónimo minero') + ' «' + g.kc + '» a ' + g.kd + ' m', g.kct === 'cueva' ? 14 : 10);
    if (g.k <= 1 && g.mA <= -1 && g.aN >= 0.03) add('Además sale fresco y húmedo en verano (satélite)', 8);
    else if (g.k <= 1 && g.mA <= -1.3) add('Además sale fresco en verano (satélite)', 5);
    if (g.qc & 1) add('Control: hay agua embalsada (charca o balsa)', -15);
    if (g.qc & 2) add('Control: edificios o naves junto al punto', -12);
    if (g.qc & 4) add('Control: pegado a una carretera o camino con taludes', -8);
    return w;
  }
  function theory(g) {
    var T = [], carb = g.carb > 0;
    if (g.k === 0 && carb) T.push(['Dolina o sima', 'En la caliza, el agua disuelve la roca por debajo y el techo acaba cediendo: queda un embudo redondo en el campo. Puede comunicar con una cavidad. Muchas se rellenaron de piedras y basura con el tiempo.']);
    if (g.k === 0 && g.kct === 'mina') T.push(['Pozo de mina hundido', 'Cerca hay minas o nombres mineros. Un hoyo redondo y hondo puede ser la boca tapada de un pozo antiguo (romano o del siglo XIX) que se ha ido hundiendo. Peligroso: el relleno puede ceder.']);
    if (g.k === 0) T.push(['Hundimiento sobre un hueco, o charca antigua', 'También pueden ser cisternas o silos hundidos, canteras pequeñas, charcas de ganado o una lumbrera de una mina de agua. El vuelo de 1956 ayuda a saber si es antiguo.']);
    if (g.k === 1 && carb) T.push(['Boca de cueva o abrigo rocoso', 'Un cortado de caliza es el sitio donde se abren las cuevas y los abrigos. Fueron refugio en la Prehistoria y a veces tienen pinturas esquemáticas, como la cercana La Calderita.']);
    if (g.k === 1 && !carb) T.push(['Abrigo rocoso o frente de cantera', 'En pizarra o granito no se forman cuevas por disolución, pero sí abrigos bajo roca y galerías mineras. Muchos cortados son canteras o taludes de camino.']);
    if (g.k === 3) T.push(['Agua bajo tierra: manantial, mina de agua o cisterna', 'Un punto que se mantiene fresco y verde en pleno verano tiene agua cerca de la superficie. Puede ser un manantial perdido, una galería de agua antigua (mina con lumbreras), un pozo o una cisterna enterrada. Los yacimientos suelen estar junto a esa agua.']);
    if (g.k === 4) T.push(['Hueco o humedad bajo tierra', 'Un punto más frío sin plantas que lo expliquen puede deberse a humedad profunda, a un hueco que guarda el fresco o a una zona de roca distinta. El satélite mide a 100 m, así que señala la zona, no el punto exacto.']);
    return T;
  }
  function score(g) { var s = 0, w = contrib(g); for (var i = 0; i < w.length; i++) s += w[i][1]; return Math.max(0, Math.min(100, Math.round(s))); }
  return { contrib: contrib, theory: theory, score: score, KIND: KIND };
})();
if (typeof module !== 'undefined') module.exports = ARQ;
