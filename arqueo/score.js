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
if (typeof module !== 'undefined') module.exports = ARQ;
