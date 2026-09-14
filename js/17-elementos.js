// ==========================================================================
// 17-elementos.js
// "Elementos" tab: reads a CSV exported from SGE/DNIT (elements list) and
// groups it by tramo -> categoria estrutural -> tipo de elemento, so each
// group's length/width/height/thickness columns can be copied straight
// into a spreadsheet.
//
// Ported from a standalone tool (leitor-elementos-sge) with changes:
//  1. Every DOM id is prefixed "elem" (elemDropzone, elemSearch, ...) so it
//     can't collide with ids anywhere else in this app.
//  2. Every CSS class this file generates or queries is prefixed "elem-"
//     (elem-group, elem-section, ...) for the same reason -- this app's
//     shared stylesheet already has classes like .stat, and unprefixed
//     generic names from a ported tool would silently override or be
//     overridden by them.
//  3. Everything is wrapped in the SAME top-level IIFE the original tool
//     already used, so none of its internal names (state, el, render,
//     parseCSV, ...) leak into the shared global scope -- this app already
//     has its own top-level parseCSV() for a different CSV format (see
//     08-kml.js), and colliding with it would silently break KML loading.
//
// Loaded as a classic script (not a module) so all files share one global
// scope, exactly like the original single-file build. Load order matters --
// see the <script> tags at the bottom of index.html.
// ==========================================================================

// Sample CSV used by the "Carregar exemplo" button in this tab.
const ELEMENTOS_SAMPLE_CSV = `ELEMENTOS SGE EXPORTAR;;;;;
ID;CODIGO;NOME DO TIPO;TRANSIÇÃO;COMPRIMENTO_X;LARGURA_Y;ALTURA_Z;LARGURA_Z;ALTURA_Y;COMPRIMENTO_Y;LARGURA_X;ESPESSURA_Z;ESPESSURA_Y
;;;;;;;;;;;;
COMPLEMENTAR;;;;;;;;;;;;
ELEMENTOS COMPLEMENTARES;;;;;;;;;;;;
5315;;BARREIRA QUALQUER DE CONCRETO ARMADO;;60,40;;0,65;;;;;;
5315;;BARREIRA QUALQUER DE CONCRETO ARMADO;;60,40;;0,65;;;;;;
;;;;;;;;;;;;
5317;;BUZINOTE DE AÇO OU PVC;;60,00;75,00;;;;;;;
5317;;BUZINOTE DE AÇO OU PVC;;60,00;75,00;;;;;;;
5317;;BUZINOTE DE AÇO OU PVC;;60,00;75,00;;;;;;;
5317;;BUZINOTE DE AÇO OU PVC;;60,00;75,00;;;;;;;
5317;;BUZINOTE DE AÇO OU PVC;;60,00;75,00;;;;;;;
5317;;BUZINOTE DE AÇO OU PVC;;60,00;75,00;;;;;;;
5317;;BUZINOTE DE AÇO OU PVC;;60,00;75,00;;;;;;;
5317;;BUZINOTE DE AÇO OU PVC;;60,00;75,00;;;;;;;
5317;;BUZINOTE DE AÇO OU PVC;;60,00;75,00;;;;;;;
5317;;BUZINOTE DE AÇO OU PVC;;60,00;75,00;;;;;;;
5317;;BUZINOTE DE AÇO OU PVC;;60,00;75,00;;;;;;;
5317;;BUZINOTE DE AÇO OU PVC;;60,00;75,00;;;;;;;
5317;;BUZINOTE DE AÇO OU PVC;;60,00;75,00;;;;;;;
5317;;BUZINOTE DE AÇO OU PVC;;60,00;75,00;;;;;;;
5317;;BUZINOTE DE AÇO OU PVC;;60,00;75,00;;;;;;;
5317;;BUZINOTE DE AÇO OU PVC;;60,00;75,00;;;;;;;
5317;;BUZINOTE DE AÇO OU PVC;;60,00;75,00;;;;;;;
5317;;BUZINOTE DE AÇO OU PVC;;60,00;75,00;;;;;;;
5317;;BUZINOTE DE AÇO OU PVC;;60,00;75,00;;;;;;;
5317;;BUZINOTE DE AÇO OU PVC;;60,00;75,00;;;;;;;
5317;;BUZINOTE DE AÇO OU PVC;;60,00;75,00;;;;;;;
5317;;BUZINOTE DE AÇO OU PVC;;60,00;75,00;;;;;;;
5317;;BUZINOTE DE AÇO OU PVC;;60,00;75,00;;;;;;;
5317;;BUZINOTE DE AÇO OU PVC;;60,00;75,00;;;;;;;
5317;;BUZINOTE DE AÇO OU PVC;;60,00;75,00;;;;;;;
5317;;BUZINOTE DE AÇO OU PVC;;60,00;75,00;;;;;;;
5317;;BUZINOTE DE AÇO OU PVC;;60,00;75,00;;;;;;;
5317;;BUZINOTE DE AÇO OU PVC;;60,00;75,00;;;;;;;
5317;;BUZINOTE DE AÇO OU PVC;;60,00;75,00;;;;;;;
5317;;BUZINOTE DE AÇO OU PVC;;60,00;75,00;;;;;;;
5317;;BUZINOTE DE AÇO OU PVC;;60,00;75,00;;;;;;;
5317;;BUZINOTE DE AÇO OU PVC;;60,00;75,00;;;;;;;
5317;;BUZINOTE DE AÇO OU PVC;;60,00;75,00;;;;;;;
5317;;BUZINOTE DE AÇO OU PVC;;60,00;75,00;;;;;;;
5317;;BUZINOTE DE AÇO OU PVC;;60,00;75,00;;;;;;;
5317;;BUZINOTE DE AÇO OU PVC;;60,00;75,00;;;;;;;
5317;;BUZINOTE DE AÇO OU PVC;;60,00;75,00;;;;;;;
5317;;BUZINOTE DE AÇO OU PVC;;60,00;75,00;;;;;;;
;;;;;;;;;;;;
5301;;PAVIMENTO ASFÁLTICO;;60,40;9,20;;;;;;7,00;
;;;;;;;;;;;;
TRAMO 01;;;;;;;;;;;;
ELEMENTOS DE APOIO;;;;;;;;;;;;
2103;01;PILAR EM COLUNAS DE CONCRETO ARMADO;;3,80;;;0,80;0,80;;;;
2103;02;PILAR EM COLUNAS DE CONCRETO ARMADO;;3,80;;;0,80;0,80;;;;
;;;;;;;;;;;;
2105;01;TRAVESSA DE APOIO DE CONCRETO ARMADO;;10,00;0,80;1,00;;;;;;
ELEMENTOS DE SUPERESTRUTURA;;;;;;;;;;;;
1111;01;VIGA T OU I DE CONCRETO ARMADO;;15,45;0,59;1,15;;;;;;
1111;02;VIGA T OU I DE CONCRETO ARMADO;;15,45;0,59;1,15;;;;;;
1111;03;VIGA T OU I DE CONCRETO ARMADO;;15,45;0,59;1,15;;;;;;
1111;04;VIGA T OU I DE CONCRETO ARMADO;;15,45;0,59;1,15;;;;;;
1111;05;VIGA T OU I DE CONCRETO ARMADO;;15,45;0,59;1,15;;;;;;
1111;06;VIGA T OU I DE CONCRETO ARMADO;;15,45;0,59;1,15;;;;;;
1111;07;VIGA T OU I DE CONCRETO ARMADO;;15,45;0,59;1,15;;;;;;
1111;08;VIGA T OU I DE CONCRETO ARMADO;;15,45;0,59;1,15;;;;;;
1111;09;VIGA T OU I DE CONCRETO ARMADO;;15,45;0,59;1,15;;;;;;
1111;10;VIGA T OU I DE CONCRETO ARMADO;;15,45;0,59;1,15;;;;;;
1111;11;VIGA T OU I DE CONCRETO ARMADO;;15,45;0,59;1,15;;;;;;
1111;12;VIGA T OU I DE CONCRETO ARMADO;;15,45;0,59;1,15;;;;;;
1111;13;VIGA T OU I DE CONCRETO ARMADO;;15,45;0,59;1,15;;;;;;
1111;14;VIGA T OU I DE CONCRETO ARMADO;;15,45;0,59;1,15;;;;;;
1111;15;VIGA T OU I DE CONCRETO ARMADO;;15,45;0,59;1,15;;;;;;
1111;16;VIGA T OU I DE CONCRETO ARMADO;;15,45;0,59;1,15;;;;;;
1111;17;VIGA T OU I DE CONCRETO ARMADO;;15,45;0,59;1,15;;;;;;
ELEMENTOS DE TRANSIÇÃO;;;;;;;;;;;;
3201;01;CORTINA DE CONCRETO ARMADO;TRANSIÇÃO 01;10,00;0,25;1,15;;;;;;
;;;;;;;;;;;;
2103;01;PILAR EM COLUNAS DE CONCRETO ARMADO;TRANSIÇÃO 01;1,30;;;0,80;0,80;;;;
2103;02;PILAR EM COLUNAS DE CONCRETO ARMADO;TRANSIÇÃO 01;1,30;;;0,80;0,80;;;;
;;;;;;;;;;;;
2105;01;TRAVESSA DE APOIO DE CONCRETO ARMADO;TRANSIÇÃO 01;10,00;1,07;1,00;;;;;;
;;;;;;;;;;;;
TRAMO 02;;;;;;;;;;;;
ELEMENTOS DE APOIO;;;;;;;;;;;;
2103;01;PILAR EM COLUNAS DE CONCRETO ARMADO;;3,50;;;0,80;0,80;;;;
2103;02;PILAR EM COLUNAS DE CONCRETO ARMADO;;3,50;;;0,80;0,80;;;;
;;;;;;;;;;;;
2105;01;TRAVESSA DE APOIO DE CONCRETO ARMADO;;10,00;0,80;1,00;;;;;;
ELEMENTOS DE SUPERESTRUTURA;;;;;;;;;;;;
1111;01;VIGA T OU I DE CONCRETO ARMADO;;14,75;0,59;1,15;;;;;;
1111;02;VIGA T OU I DE CONCRETO ARMADO;;14,75;0,59;1,15;;;;;;
1111;03;VIGA T OU I DE CONCRETO ARMADO;;14,75;0,59;1,15;;;;;;
1111;04;VIGA T OU I DE CONCRETO ARMADO;;14,75;0,59;1,15;;;;;;
1111;05;VIGA T OU I DE CONCRETO ARMADO;;14,75;0,59;1,15;;;;;;
1111;06;VIGA T OU I DE CONCRETO ARMADO;;14,75;0,59;1,15;;;;;;
1111;07;VIGA T OU I DE CONCRETO ARMADO;;14,75;0,59;1,15;;;;;;
1111;08;VIGA T OU I DE CONCRETO ARMADO;;14,75;0,59;1,15;;;;;;
1111;09;VIGA T OU I DE CONCRETO ARMADO;;14,75;0,59;1,15;;;;;;
1111;10;VIGA T OU I DE CONCRETO ARMADO;;14,75;0,59;1,15;;;;;;
1111;11;VIGA T OU I DE CONCRETO ARMADO;;14,75;0,59;1,15;;;;;;
1111;12;VIGA T OU I DE CONCRETO ARMADO;;14,75;0,59;1,15;;;;;;
1111;13;VIGA T OU I DE CONCRETO ARMADO;;14,75;0,59;1,15;;;;;;
1111;14;VIGA T OU I DE CONCRETO ARMADO;;14,75;0,59;1,15;;;;;;
1111;15;VIGA T OU I DE CONCRETO ARMADO;;14,75;0,59;1,15;;;;;;
1111;16;VIGA T OU I DE CONCRETO ARMADO;;14,75;0,59;1,15;;;;;;
1111;17;VIGA T OU I DE CONCRETO ARMADO;;14,75;0,59;1,15;;;;;;
;;;;;;;;;;;;
TRAMO 03;;;;;;;;;;;;
ELEMENTOS DE APOIO;;;;;;;;;;;;
4101;01;BLOCO OU SAPATA DE CONCRETO ARMADO;;1,50;1,50;0,50;;;;;;
4101;02;BLOCO OU SAPATA DE CONCRETO ARMADO;;1,50;1,50;0,50;;;;;;
;;;;;;;;;;;;
2103;01;PILAR EM COLUNAS DE CONCRETO ARMADO;;3,80;;;0,80;0,80;;;;
2103;02;PILAR EM COLUNAS DE CONCRETO ARMADO;;3,80;;;0,80;0,80;;;;
;;;;;;;;;;;;
2105;01;TRAVESSA DE APOIO DE CONCRETO ARMADO;;10,00;0,80;1,00;;;;;;
ELEMENTOS DE SUPERESTRUTURA;;;;;;;;;;;;
1111;01;VIGA T OU I DE CONCRETO ARMADO;;14,75;0,59;1,15;;;;;;
1111;02;VIGA T OU I DE CONCRETO ARMADO;;14,75;0,59;1,15;;;;;;
1111;03;VIGA T OU I DE CONCRETO ARMADO;;14,75;0,59;1,15;;;;;;
1111;04;VIGA T OU I DE CONCRETO ARMADO;;14,75;0,59;1,15;;;;;;
1111;05;VIGA T OU I DE CONCRETO ARMADO;;14,75;0,59;1,15;;;;;;
1111;06;VIGA T OU I DE CONCRETO ARMADO;;14,75;0,59;1,15;;;;;;
1111;07;VIGA T OU I DE CONCRETO ARMADO;;14,75;0,59;1,15;;;;;;
1111;08;VIGA T OU I DE CONCRETO ARMADO;;14,75;0,59;1,15;;;;;;
1111;09;VIGA T OU I DE CONCRETO ARMADO;;14,75;0,59;1,15;;;;;;
1111;10;VIGA T OU I DE CONCRETO ARMADO;;14,75;0,59;1,15;;;;;;
1111;11;VIGA T OU I DE CONCRETO ARMADO;;14,75;0,59;1,15;;;;;;
1111;12;VIGA T OU I DE CONCRETO ARMADO;;14,75;0,59;1,15;;;;;;
1111;13;VIGA T OU I DE CONCRETO ARMADO;;14,75;0,59;1,15;;;;;;
1111;14;VIGA T OU I DE CONCRETO ARMADO;;14,75;0,59;1,15;;;;;;
1111;15;VIGA T OU I DE CONCRETO ARMADO;;14,75;0,59;1,15;;;;;;
1111;16;VIGA T OU I DE CONCRETO ARMADO;;14,75;0,59;1,15;;;;;;
1111;17;VIGA T OU I DE CONCRETO ARMADO;;14,75;0,59;1,15;;;;;;
;;;;;;;;;;;;
TRAMO 04;;;;;;;;;;;;
ELEMENTOS DE SUPERESTRUTURA;;;;;;;;;;;;
1111;01;VIGA T OU I DE CONCRETO ARMADO;;15,45;0,59;1,15;;;;;;
1111;02;VIGA T OU I DE CONCRETO ARMADO;;15,45;0,59;1,15;;;;;;
1111;03;VIGA T OU I DE CONCRETO ARMADO;;15,45;0,59;1,15;;;;;;
1111;04;VIGA T OU I DE CONCRETO ARMADO;;15,45;0,59;1,15;;;;;;
1111;05;VIGA T OU I DE CONCRETO ARMADO;;15,45;0,59;1,15;;;;;;
1111;06;VIGA T OU I DE CONCRETO ARMADO;;15,45;0,59;1,15;;;;;;
1111;07;VIGA T OU I DE CONCRETO ARMADO;;15,45;0,59;1,15;;;;;;
1111;08;VIGA T OU I DE CONCRETO ARMADO;;15,45;0,59;1,15;;;;;;
1111;09;VIGA T OU I DE CONCRETO ARMADO;;15,45;0,59;1,15;;;;;;
1111;10;VIGA T OU I DE CONCRETO ARMADO;;15,45;0,59;1,15;;;;;;
1111;11;VIGA T OU I DE CONCRETO ARMADO;;15,45;0,59;1,15;;;;;;
1111;12;VIGA T OU I DE CONCRETO ARMADO;;15,45;0,59;1,15;;;;;;
1111;13;VIGA T OU I DE CONCRETO ARMADO;;15,45;0,59;1,15;;;;;;
1111;14;VIGA T OU I DE CONCRETO ARMADO;;15,45;0,59;1,15;;;;;;
1111;15;VIGA T OU I DE CONCRETO ARMADO;;15,45;0,59;1,15;;;;;;
1111;16;VIGA T OU I DE CONCRETO ARMADO;;15,45;0,59;1,15;;;;;;
1111;17;VIGA T OU I DE CONCRETO ARMADO;;15,45;0,59;1,15;;;;;;
ELEMENTOS DE TRANSIÇÃO;;;;;;;;;;;;
3201;01;CORTINA DE CONCRETO ARMADO;TRANSIÇÃO 02;10,00;0,25;1,15;;;;;;
;;;;;;;;;;;;
2103;01;PILAR EM COLUNAS DE CONCRETO ARMADO;TRANSIÇÃO 02;1,30;;;0,80;0,80;;;;
2103;02;PILAR EM COLUNAS DE CONCRETO ARMADO;TRANSIÇÃO 02;1,30;;;0,80;0,80;;;;
;;;;;;;;;;;;
2105;01;TRAVESSA DE APOIO DE CONCRETO ARMADO;TRANSIÇÃO 02;10,00;1,07;1,00;;;;;;
Grand total: 128;;;;;;;;;;;;
`;

// Catálogo oficial SGE/DNIT de tipos de elemento (Código;Nome;Categoria) --
// usado só para ORDENAR os grupos dentro de cada subdivisão pelo código do
// tipo, já que o campo ID de cada elemento na planilha do projeto às vezes
// vem em branco (nem toda linha exportada do SGE preenche ID). Ver
// ELEMENTOS_CODE_BY_NAME logo abaixo, dentro da IIFE, que faz a busca por
// nome -> código.
const ELEMENTOS_CODE_CATALOG_CSV = `Código;Nome;Categoria
2101;Pilar parede de alvenaria de pedra;Transição
2102;Pilar parede de concreto armado;Transição
2103;Pilar em colunas de concreto armado;Transição
2104;Pilar vazado de concreto armado;Transição
2105;Travessa de apoio de concreto armado;Transição
2106;Travessa de apoio de concreto protendido;Transição
2107;Aparelho de apoio de neoprene fretado;Transição
2108;Aparelho de apoio de teflon;Transição
2109;Aparelho de apoio de rolo metálico;Transição
2110;Aparelho de apoio de placa de chumbo;Transição
2111;Aparelho de apoio tipo 'pot bearing' Fixo;Transição
2112;Aparelho de apoio tipo 'pot bearing' direcional;Transição
2113;Aparelho de apoio freyssinet;Transição
2114;Aparelho de apoio pêndulo;Transição
2115;Articulação de aço;Transição
2117;Reforço pilar - Encamisamento de pilar;Transição
2118;Reforço estaca - Encamisamento de trecho livre;Transição
2119;Aparelho de apoio oscilante;Transição
2120;Pilar de aço;Transição
2121;Bloco ou Sapata em alvenaria de pedra;Transição
2122;Travessa de apoio de aço;Transição
2201;Viga de contraventamento de pilar de concreto armado;Transição
2202;Parede de contraventamento de pilar de concreto armado;Transição
2203;Viga de ligação de fundações;Transição
2204;Berço, elemento ou pilarete de nivelamento;Transição
2301;Consolo auxiliar de concreto armado;Transição
2302;Radier de alvenaria de pedra e de concreto armado;Transição
3101;Encontro - Parede frontal portante de concreto armado;Transição
3102;Encontro de alvenaria de pedra;Transição
3103;Encontro - Parede lateral e vigas de concreto armado;Transição
3104;Encontro - Laje de concreto armado;Transição
3201;Cortina de concreto armado;Transição
3202;Encontro - Cortina de concreto armado;Transição
3203;Encontro - Paredes e vigas secundárias de concreto;Transição
3204;Ala de concreto armado;Transição
3205;Muro de arrimo de alvenaria de pedra;Transição
3206;Contenção em cortina de estacas de concreto armado;Transição
3301;Laje de transição;Transição
3302;Aterro de acesso;Transição
3303;Muro de arrimo de concreto;Transição
3304;Revestimento de talude em concreto;Transição
3305;Muro de terra armada;Transição
3306;Muro de gabião;Transição
3307;Defensa Metálica;Transição
4101;Bloco ou Sapata de concreto armado;Transição
4102;Tubulão ou estacão de concreto armado;Transição
4103;Estaca de concreto armado;Transição
4104;Estaca de aço;Transição
4105;Estaca de madeira;Transição
4106;Escada de aço;Transição
4107;Escada - Patamar de aço;Transição
4108;Escada de concreto armado;Transição
4109;Escada - Patamar de concreto armado;Transição
4201;Camisa metálica de revestimento para estaca;Transição
1101;Laje de concreto armado;Superestrutura
1102;Laje de concreto protendido;Superestrutura
1103;Laje de aço ortotrópica;Superestrutura
1104;Laje metálica de chapa corrugada;Superestrutura
1105;Ponte em laje de concreto armado;Superestrutura
1106;Ponte em laje de concreto protendido;Superestrutura
1107;Laje em pranchão de madeira;Superestrutura
1108;Viga caixão de concreto armado;Superestrutura
1109;Viga caixão de concreto protendido;Superestrutura
1110;Viga caixão de aço;Superestrutura
1111;Viga I ou T de concreto armado;Superestrutura
1112;Viga I ou T de concreto protendido;Superestrutura
1113;Viga I de aço;Superestrutura
1114;Dente Gerber de concreto armado;Superestrutura
1115;Dente Gerber de concreto armado com protensão;Superestrutura
1116;Transversina portante de concreto armado;Superestrutura
1117;Transversina portante de concreto protendido;Superestrutura
1118;Transversina portante de aço;Superestrutura
1119;Dente Gerber de aço;Superestrutura
1120;Arco de concreto armado;Superestrutura
1121;Arco de concreto protendido;Superestrutura
1122;Arco metálico;Superestrutura
1123;Treliça de concreto armado;Superestrutura
1124;Treliça de aço;Superestrutura
1125;Estais;Superestrutura
1126;Ancoragens de estais;Superestrutura
1127;Reforço laje I - Sobrelaje de concreto armado;Superestrutura
1128;Reforço laje II - Infradorso laje em concreto armado;Superestrutura
1129;Reforço viga I - Encamisamento de viga;Superestrutura
1130;Reforço viga II - Armadura principal passiva;Superestrutura
1131;Reforço viga III - Cabo de protensão externo;Superestrutura
1132;Reforço viga IV - Bloqueio de articulação Gerber;Superestrutura
1133;Viga U de concreto armado;Superestrutura
1134;Arco celular de concreto armado;Superestrutura
1135;Revestimento em chapas corrugadas de aço;Superestrutura
1136;Arco de alvenaria de pedra;Superestrutura
1137;Banzo superior de aço de treliça vertical;Superestrutura
1138;Banzo inferior de aço de treliça vertical;Superestrutura
1139;Diagonal de concreto de treliça vertical;Superestrutura
1140;Montante de aço de treliça vertical;Superestrutura
1141;Banzo superior de concreto de treliça vertical;Superestrutura
1142;Banzo inferior de concreto de treliça vertical;Superestrutura
1143;Montante de concreto de treliça vertical;Superestrutura
1145;Diagonal de aço de treliça vertical;Superestrutura
1201;Transversina de ligação de concreto armado;Superestrutura
1202;Transversina de ligação de concreto protendido;Superestrutura
1203;Transversina de ligação de aço;Superestrutura
1204;Longarina de enrijecimento de laje;Superestrutura
1205;Viga secundária;Superestrutura
1206;Diagonal de aço horizontal de travamento;Superestrutura
1207;Diagonal de concreto horizontal de travamento;Superestrutura
1208;Transversina de aço de travamento;Superestrutura
1209;Longarina de aço de travamento;Superestrutura
1210;Mão francesa de concreto armado;Superestrutura
1211;Mão francesa de aço;Superestrutura
1212;Contraventamento de aço;Superestrutura
2101;Pilar parede de alvenaria de pedra;Apoio
2102;Pilar parede de concreto armado;Apoio
2103;Pilar em colunas de concreto armado;Apoio
2104;Pilar vazado de concreto armado;Apoio
2105;Travessa de apoio de concreto armado;Apoio
2106;Travessa de apoio de concreto protendido;Apoio
2107;Aparelho de apoio de neoprene fretado;Apoio
2108;Aparelho de apoio de teflon;Apoio
2109;Aparelho de apoio de rolo metálico;Apoio
2110;Aparelho de apoio de placa de chumbo;Apoio
2111;Aparelho de apoio tipo 'pot bearing' Fixo;Apoio
2112;Aparelho de apoio tipo 'pot bearing' direcional;Apoio
2113;Aparelho de apoio freyssinet;Apoio
2114;Aparelho de apoio pêndulo;Apoio
2115;Articulação de aço;Apoio
2116;Torre de concreto armado para estaiamento;Apoio
2117;Reforço pilar - Encamisamento de pilar;Apoio
2118;Reforço estaca - Encamisamento de trecho livre;Apoio
2119;Aparelho de apoio oscilante;Apoio
2120;Pilar de aço;Apoio
2121;Bloco ou Sapata em alvenaria de pedra;Apoio
2122;Travessa de apoio de aço;Apoio
2201;Viga de contraventamento de pilar de concreto armado;Apoio
2202;Parede de contraventamento de pilar de concreto armado;Apoio
2203;Viga de ligação de fundações;Apoio
2204;Berço, elemento ou pilarete de nivelamento;Apoio
2301;Consolo auxiliar de concreto armado;Apoio
2302;Radier de alvenaria de pedra e de concreto armado;Apoio
4101;Bloco ou Sapata de concreto armado;Apoio
4102;Tubulão ou estacão de concreto armado;Apoio
4103;Estaca de concreto armado;Apoio
4104;Estaca de aço;Apoio
4105;Estaca de madeira;Apoio
4106;Escada de aço;Apoio
4107;Escada - Patamar de aço;Apoio
4108;Escada de concreto armado;Apoio
4109;Escada - Patamar de concreto armado;Apoio
4201;Camisa metálica de revestimento para estaca;Apoio
1301;Tela de aço;Complementar
5301;Pavimento asfáltico;Complementar
5302;Pavimento de concreto;Complementar
5303;Barreira New Jersey;Complementar
5304;Guarda rodas antigo do DNER;Complementar
5305;Guarda rodas qualquer;Complementar
5306;Guarda corpo de concreto armado;Complementar
5307;Guarda corpo de aço;Complementar
5308;Calçada para pedestres de concreto armado;Complementar
5309;Calçada para pedestres metálica;Complementar
5310;Berço para junta de dilatação;Complementar
5311;Junta elastomérica de dilatação;Complementar
5312;Junta de dilatação;Complementar
5313;Junta metálica de dilatação;Complementar
5314;Guarda corpo misto (concreto armado e de aço);Complementar
5315;Barreira qualquer de concreto armado;Complementar
5316;Barreira New Jersey com guarda-corpo de concreto armado;Complementar
5317;Buzinote de aço ou PVC;Complementar
5318;Cobertura para pedestres;Complementar`;

(function(){

  "use strict";

  var state = { rows: [], headerMap: {}, dimCols: [], contextCols: [], allExpanded: false, copiedKeys: {} };

  // ---------- catálogo SGE (nome do tipo -> código oficial) ----------
  // Construído uma vez a partir de ELEMENTOS_CODE_CATALOG_CSV (topo do
  // arquivo). Algumas linhas do catálogo repetem o mesmo nome em duas
  // categorias (ex.: "Pilar de aço" existe em Transição E em Apoio) com o
  // MESMO código -- por isso um mapa nome->código simplesmente sobrescreve
  // com o mesmo valor, sem gerar ambiguidade.
  var ELEMENTOS_CODE_BY_NAME = (function(){
    var map = {};
    var lines = (ELEMENTOS_CODE_CATALOG_CSV || '').split('\n');
    for (var i = 1; i < lines.length; i++){ // pula o cabeçalho
      var line = lines[i].trim();
      if (!line) continue;
      var cells = line.split(';');
      var code = parseInt(cells[0], 10);
      var nome = (cells[1] || '').trim().toUpperCase();
      if (nome && !isNaN(code)) map[nome] = code;
    }
    return map;
  })();

  function catalogCode(nome){
    var key = (nome || '').trim().toUpperCase();
    return Object.prototype.hasOwnProperty.call(ELEMENTOS_CODE_BY_NAME, key) ? ELEMENTOS_CODE_BY_NAME[key] : null;
  }

  // ---------- CSV parsing ----------
  function stripBOM(text){ return text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text; }

  function splitCSVLine(line, delim){
    var out = [], cur = '', inQuotes = false;
    for (var i=0;i<line.length;i++){
      var ch = line[i];
      if (inQuotes){
        if (ch === '"'){
          if (line[i+1] === '"'){ cur += '"'; i++; } else { inQuotes = false; }
        } else { cur += ch; }
      } else {
        if (ch === '"'){ inQuotes = true; }
        else if (ch === delim){ out.push(cur); cur=''; }
        else { cur += ch; }
      }
    }
    out.push(cur);
    return out;
  }

  function detectDelimiter(lines){
    var candidates = [';', '\t', ','];
    for (var c=0;c<candidates.length;c++){
      var delim = candidates[c];
      for (var i=0;i<Math.min(lines.length,20);i++){
        var cells = splitCSVLine(lines[i], delim);
        if (cells.length > 1 && cells[0].trim().toUpperCase() === 'ID'){
          return delim;
        }
      }
    }
    // fallback: whichever delimiter yields most columns on the fattest early line
    var best = ';', bestCount = 0;
    candidates.forEach(function(delim){
      for (var i=0;i<Math.min(lines.length,20);i++){
        var n = splitCSVLine(lines[i], delim).length;
        if (n > bestCount){ bestCount = n; best = delim; }
      }
    });
    return best;
  }

  function normHeader(h){
    return h.trim().toUpperCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  }

  function parseCSV(text){
    text = stripBOM(text).replace(/\r\n/g, '\n').replace(/\r/g,'\n');
    var lines = text.split('\n');
    var delim = detectDelimiter(lines);

    var headerIdx = -1, headerCells = null;
    for (var i=0;i<lines.length;i++){
      var cells = splitCSVLine(lines[i], delim);
      if (cells[0] && cells[0].trim().toUpperCase() === 'ID'){
        headerIdx = i; headerCells = cells.map(function(c){return c.trim();});
        break;
      }
    }
    if (headerIdx === -1){
      // fallback: row with most non-empty cells among first 15 lines, excluding a lone title row
      var bestI=-1, bestN=0;
      for (var j=0;j<Math.min(lines.length,15);j++){
        var c2 = splitCSVLine(lines[j], delim);
        var n = c2.filter(function(x){return x.trim()!=='';}).length;
        if (n > bestN){ bestN = n; bestI = j; }
      }
      headerIdx = bestI;
      headerCells = splitCSVLine(lines[bestI], delim).map(function(c){return c.trim() || ('COL'+(bestI+1));});
    }

    // identify known columns
    var idx = { id:-1, codigo:-1, nome:-1, transicao:-1 };
    headerCells.forEach(function(h, i){
      var n = normHeader(h);
      if (idx.id === -1 && n === 'ID') idx.id = i;
      else if (idx.codigo === -1 && n === 'CODIGO') idx.codigo = i;
      else if (idx.nome === -1 && n.indexOf('NOME') !== -1) idx.nome = i;
      else if (idx.transicao === -1 && n.indexOf('TRANSI') !== -1) idx.transicao = i;
    });
    var dimIdxs = [];
    headerCells.forEach(function(h,i){
      if (i!==idx.id && i!==idx.codigo && i!==idx.nome && i!==idx.transicao) dimIdxs.push(i);
    });

    var rows = [];
    var currentTramo = '', currentCategoria = '';

    for (var r = headerIdx+1; r<lines.length; r++){
      var raw = lines[r];
      if (raw === undefined) continue;
      var cells = splitCSVLine(raw, delim);
      var nonEmpty = cells.filter(function(x){return x.trim()!=='';});
      if (nonEmpty.length === 0) continue;

      if (nonEmpty.length === 1 && cells[0].trim() !== ''){
        var label = cells[0].trim();
        if (/^grand total/i.test(label)) continue;
        if (/^elementos\b/i.test(label)) { currentCategoria = label; }
        else { currentTramo = label; currentCategoria = ''; }
        continue;
      }

      // data row — must have at least a nome or id to be meaningful
      var idVal = idx.id!==-1 ? (cells[idx.id]||'').trim() : '';
      var nomeVal = idx.nome!==-1 ? (cells[idx.nome]||'').trim() : '';
      if (idVal === '' && nomeVal === '') continue;

      var obj = { __tramo: currentTramo, __categoria: currentCategoria, __dims:{} };
      obj.id = idVal;
      obj.codigo = idx.codigo!==-1 ? (cells[idx.codigo]||'').trim() : '';
      obj.nome = nomeVal;
      obj.transicao = idx.transicao!==-1 ? (cells[idx.transicao]||'').trim() : '';
      dimIdxs.forEach(function(di){
        obj.__dims[headerCells[di]] = (cells[di]||'').trim();
      });
      rows.push(obj);
    }

    // keep only dimension columns that have at least one non-empty value
    var dimCols = [];
    dimIdxs.forEach(function(di){
      var h = headerCells[di];
      var hasValue = rows.some(function(r){ return r.__dims[h] !== ''; });
      if (hasValue) dimCols.push(h);
    });

    var contextCols = [];
    if (idx.codigo!==-1 && rows.some(function(r){return r.codigo!=='';})) contextCols.push('codigo');
    if (rows.some(function(r){return r.__tramo!=='';})) contextCols.push('__tramo');
    if (rows.some(function(r){return r.__categoria!=='';})) contextCols.push('__categoria');
    if (idx.transicao!==-1 && rows.some(function(r){return r.transicao!=='';})) contextCols.push('transicao');

    rows = addDefaultElements(rows, dimCols);

    return { rows: rows, dimCols: dimCols, contextCols: contextCols };
  }

  // ---------- elementos padrão (preenchidos automaticamente quando faltam) ----------
  // Alguns tipos quase sempre existem na obra mas às vezes saem de fora da
  // exportação do SGE -- em vez de a pessoa ter que lembrar de criar essas
  // linhas na mão, a ferramenta adiciona um card em branco (só com o tipo
  // certo, pronto pra preencher/copiar as medidas depois) sempre que a
  // seção correspondente (TRANSIÇÃO ou COMPLEMENTAR) já existe nos dados
  // mas esse elemento específico não aparece nela. Se o elemento já vier
  // no CSV, nada é adicionado -- os dados reais sempre têm prioridade.
  var DEFAULT_ELEMENTS = [
    // "por transição": uma cópia para cada seção TRANSIÇÃO que já exista
    // nos dados (uma obra de 2 tramos com transição em cada ponta gera 2
    // dessas, uma por transição -- não uma vez só pra obra toda).
    { code: 3302, nome: 'Aterro de acesso',   scope: 'transicao',    qty: 1 },
    { code: 3307, nome: 'Defensa Metálica',   scope: 'transicao',    qty: 2 },
    // Junta de dilatação é COMPLEMENTAR, não por transição -- 2 unidades
    // por seção Complementares que já exista nos dados.
    { code: 5312, nome: 'Junta de dilatação', scope: 'complementar', qty: 2 }
  ];

  function addDefaultElements(rows, dimCols){
    // Agrupa as linhas reais por (tramo, categoria, transição) pra achar
    // quais seções TRANSIÇÃO/COMPLEMENTAR já existem nos dados, e o que já
    // está preenchido em cada uma.
    var seen = {};
    rows.forEach(function(r){
      var key = r.__tramo + '␟' + r.__categoria + '␟' + (r.transicao||'');
      if (!seen[key]) seen[key] = { tramo:r.__tramo, categoria:r.__categoria, transicao:r.transicao||'', names:{} };
      seen[key].names[(r.nome||'').trim().toUpperCase()] = true;
    });

    var extra = [];
    Object.keys(seen).forEach(function(key){
      var g = seen[key];
      var isTransicao   = /TRANSI/i.test(g.categoria) || /TRANSI/i.test(g.tramo);
      var isComplementar = /COMPLEMENTAR/i.test(g.categoria) || /COMPLEMENTAR/i.test(g.tramo);
      DEFAULT_ELEMENTS.forEach(function(def){
        if (def.scope === 'transicao' && !isTransicao) return;
        if (def.scope === 'complementar' && !isComplementar) return;
        if (g.names[def.nome.toUpperCase()]) return; // já existe -- não duplica
        for (var i=0; i<def.qty; i++){
          // Todas as medidas desses elementos padrão saem como "0" (em vez
          // de em branco) -- é o valor que a pessoa pediu para eles.
          var dims = {};
          (dimCols||[]).forEach(function(col){ dims[col] = '0'; });
          extra.push({
            __tramo: g.tramo, __categoria: g.categoria, __dims: dims,
            id: String(def.code), codigo: '', nome: def.nome, transicao: g.transicao
          });
        }
      });
    });
    return rows.concat(extra);
  }

  var COL_LABELS = { codigo:'CÓDIGO', __tramo:'TRAMO', __categoria:'CATEGORIA', transicao:'TRANSIÇÃO' };

  // ordem fixa de categorias dentro de cada tramo (padrão)
  var CATEGORY_ORDER_DEFAULT = [
    /TRANSI/i,
    /SUPERESTRUTURA/i,
    /APOIO/i
  ];

  // ordem para o último tramo cadastrado (sem elementos de apoio)
  var CATEGORY_ORDER_LAST_TRAMO = [
    /SUPERESTRUTURA/i,
    /TRANSI/i,
    /APOIO/i
  ];

  function categoryRank(label, orderArr){
    for (var i=0;i<orderArr.length;i++){
      if (orderArr[i].test(label)) return i;
    }
    return orderArr.length; // categorias não previstas (ex: complementares) vão depois, na ordem em que aparecem
  }

  function tramoRank(label){
    if (/^COMPLEMENTAR/i.test(label)) return -1;
    var m = label.match(/(\d+)/);
    if (m) return parseInt(m[1], 10);
    return 9999;
  }

  // ---------- grouping (id + nome) dentro de um conjunto de linhas ----------
  function groupRows(rows){
    var map = {}, order = [];
    rows.forEach(function(r){
      var key = r.id + '␟' + r.nome.toUpperCase();
      if (!map[key]){
        map[key] = { id:r.id, nome:r.nome, rows:[] };
        order.push(key);
      }
      map[key].rows.push(r);
    });
    var groups = order.map(function(k){ return map[k]; });
    // Ordem crescente dentro de cada subdivisão (categoria): primeiro pelo
    // código oficial do catálogo SGE (busca pelo nome do tipo) -- é isso
    // que resolve o caso de a planilha do projeto não ter ID preenchido
    // para todo elemento. Só cai para o ID da própria planilha quando o
    // nome não está no catálogo (tipo fora do padrão) ou os dois lados
    // têm o mesmo código.
    groups.sort(function(a,b){
      var ca = catalogCode(a.nome), cb = catalogCode(b.nome);
      if (ca != null && cb != null && ca !== cb) return ca - cb;
      if (ca != null && cb == null) return -1;
      if (ca == null && cb != null) return 1;
      if (a.id && b.id){
        var c = a.id.localeCompare(b.id, 'pt-BR', {numeric:true});
        if (c !== 0) return c;
      } else if (a.id && !b.id){
        return -1;
      } else if (!a.id && b.id){
        return 1;
      }
      return a.nome.localeCompare(b.nome, 'pt-BR');
    });
    return groups;
  }

  // ---------- hierarquia: tramo -> categoria -> grupos ----------
  function transTagNum(tag){
    var m = tag && tag.match(/(\d+)/);
    return m ? parseInt(m[1], 10) : 999;
  }

  // ordena as categorias de uma obra de 1 tramo: complementares, transição (nº menor),
  // superestrutura, transição (nº maior) — não depende da ordem em que aparecem no arquivo
  function orderSingleTramoCategories(cats){
    var isComp = function(c){ return /COMPLEMENTAR/i.test(c.label); };
    var isTrans = function(c){ return /TRANSI/i.test(c.label); };
    var isSuper = function(c){ return /SUPERESTRUTURA/i.test(c.label); };
    var isApoio = function(c){ return /APOIO/i.test(c.label); };

    var comp = cats.filter(isComp);
    var trans = cats.filter(isTrans).sort(function(a,b){
      var na = transTagNum(a.tag), nb = transTagNum(b.tag);
      if (na !== nb) return na - nb;
      return a.firstSeen - b.firstSeen;
    });
    var supr = cats.filter(isSuper);
    var apoio = cats.filter(isApoio);
    var matched = comp.concat(trans, supr, apoio);
    var others = cats.filter(function(c){ return matched.indexOf(c) === -1; });

    var ordered = comp.slice();
    if (trans.length >= 2){
      ordered.push(trans[0]);
      ordered = ordered.concat(supr);
      ordered = ordered.concat(trans.slice(1));
    } else {
      ordered = ordered.concat(trans).concat(supr);
    }
    ordered = ordered.concat(apoio).concat(others);
    return ordered;
  }

  // A hierarquia (agrupamento por tramo/categoria/tipo) só depende de
  // state.rows, não da busca -- mas render() era chamado a cada tecla
  // digitada em #elemSearch, e recalculava tudo do zero (incluindo o
  // agrupamento de milhares de linhas) só para aplicar um filtro de texto.
  // Cacheia o resultado e só invalida quando um novo CSV é carregado.
  var _hierarchyCache = null;
  function buildHierarchy(){
    if (_hierarchyCache) return _hierarchyCache;
    var tramoMap = {}, tramoOrder = [];
    state.rows.forEach(function(r){
      var tramo = r.__tramo || '(sem tramo)';
      var catLabel = r.__categoria || '(sem categoria)';
      // elementos de transição são separados por qual TRANSIÇÃO pertencem (relevante
      // em obras de 1 tramo, onde existe transição no início E no fim da obra)
      var transTag = /TRANSI/i.test(catLabel) ? (r.transicao || '') : '';
      var catKey = catLabel + '␟' + transTag;
      if (!tramoMap[tramo]){ tramoMap[tramo] = { label:tramo, catMap:{}, catOrder:[] }; tramoOrder.push(tramo); }
      var t = tramoMap[tramo];
      if (!t.catMap[catKey]){ t.catMap[catKey] = { label:catLabel, tag:transTag, rows:[] }; t.catOrder.push(catKey); }
      t.catMap[catKey].rows.push(r);
    });

    var sections = tramoOrder.map(function(label){ return tramoMap[label]; });
    sections.sort(function(a,b){ return tramoRank(a.label) - tramoRank(b.label); });

    var tramoSections = sections.filter(function(s){ return /^TRAMO\b/i.test(s.label); });

    // o último "TRAMO N" da sequência (ignora COMPLEMENTAR e rótulos fora do padrão) usa ordem diferente
    var lastTramoIdx = -1;
    for (var i=sections.length-1; i>=0; i--){
      if (/^TRAMO\b/i.test(sections[i].label)){ lastTramoIdx = i; break; }
    }

    _hierarchyCache = sections.map(function(sec, secIdx){
      var isTramoSection = /^TRAMO\b/i.test(sec.label);
      // obras de 1 tramo não têm apoio e têm transição no início e no fim: ordem fixa
      // complementares > transição inicial > superestrutura > transição final.
      var singleTramoWork = isTramoSection && tramoSections.length === 1;
      var orderArr = (secIdx === lastTramoIdx) ? CATEGORY_ORDER_LAST_TRAMO : CATEGORY_ORDER_DEFAULT;

      var cats = sec.catOrder.map(function(catKey, idx){
        var entry = sec.catMap[catKey];
        return { label: entry.label, tag: entry.tag, rows: entry.rows, firstSeen: idx };
      });

      if (singleTramoWork){
        cats = orderSingleTramoCategories(cats);
      } else {
        cats.sort(function(a,b){
          var ra = categoryRank(a.label, orderArr), rb = categoryRank(b.label, orderArr);
          if (ra !== rb) return ra - rb;
          return a.firstSeen - b.firstSeen;
        });
      }

      return {
        label: sec.label,
        elemCount: cats.reduce(function(n,c){ return n + c.rows.length; }, 0),
        categories: cats.map(function(c){ return { label:c.label, tag:c.tag, groups: groupRows(c.rows) }; })
      };
    });
    return _hierarchyCache;
  }

  // ---------- rendering ----------
  function el(tag, attrs, children){
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function(k){
      if (k==='class') e.className = attrs[k];
      else if (k==='text') e.textContent = attrs[k];
      else e.setAttribute(k, attrs[k]);
    });
    (children||[]).forEach(function(c){ if(c) e.appendChild(c); });
    return e;
  }

  function cellValue(row, col){
    if (col in COL_LABELS) return row[col] || '';
    return row.__dims[col] || '';
  }

  function renderGroupCard(g, columns, groupKey){
    var isCopied = !!state.copiedKeys[groupKey];
    var groupEl = el('div', {class:'elem-group' + (state.allExpanded ? '' : ' elem-collapsed') + (isCopied ? ' elem-group-copied' : '')});
    groupEl.appendChild(el('div',{class:'elem-g-corner-tr'}));
    groupEl.appendChild(el('div',{class:'elem-g-corner-br'}));

    var head = el('div', {class:'elem-g-head'});
    var title = el('div', {class:'elem-g-title'}, [
      el('span', {class:'elem-caret', text:'▾'}),
      el('span', {class:'elem-g-name', text:g.nome || '(sem nome)'}),
      el('span', {class:'elem-g-id', text:'ID ' + (g.id || '—')}),
      el('span', {class:'elem-g-count', text:g.rows.length + (g.rows.length===1?' elemento':' elementos')}),
      el('span', {class:'elem-copied-badge'}, [el('span',{text:'✓ copiado'})])
    ]);
    var actions = el('div', {class:'elem-g-actions'});
    var copyDimsBtn = el('button', {class:'elem-btn elem-copy-dims', type:'button', text: isCopied ? 'Copiar de novo' : 'Copiar dimensões'});
    copyDimsBtn.addEventListener('click', function(ev){
      ev.stopPropagation();
      copyGroupDimensions(g).then(function(){
        state.copiedKeys[groupKey] = true;
        groupEl.classList.add('elem-group-copied');
        copyDimsBtn.classList.add('elem-copied');
        copyDimsBtn.textContent = 'Copiado ✓';
        setTimeout(function(){
          copyDimsBtn.classList.remove('elem-copied');
          copyDimsBtn.textContent = 'Copiar de novo';
        }, 1400);
      }).catch(function(){
        // Don't mark the group as copied when nothing reached the
        // clipboard -- that would wrongly signal the group is done.
        var original = copyDimsBtn.textContent;
        copyDimsBtn.textContent = 'Falhou';
        setTimeout(function(){ copyDimsBtn.textContent = original; }, 1500);
      });
    });
    actions.appendChild(copyDimsBtn);
    head.appendChild(title);
    head.appendChild(actions);
    head.addEventListener('click', function(){
      groupEl.classList.toggle('elem-collapsed');
    });
    groupEl.appendChild(head);

    var body = el('div', {class:'elem-g-body'});
    var table = document.createElement('table');
    var thead = document.createElement('thead');
    var trh = document.createElement('tr');
    trh.appendChild(el('th', {class:'elem-col-idx', text:'#'}));
    columns.forEach(function(col){
      var th = document.createElement('th');
      var inner = el('div', {class:'elem-th-inner'});
      inner.appendChild(el('span', {text: COL_LABELS[col] || col}));
      if (state.dimCols.indexOf(col) !== -1){
        var copyBtn = el('button', {class:'elem-col-copy', type:'button', title:'Copiar coluna', text:'⧉'});
        copyBtn.addEventListener('click', function(){ copyColumn(g, col, copyBtn); });
        inner.appendChild(copyBtn);
      }
      th.appendChild(inner);
      trh.appendChild(th);
    });
    thead.appendChild(trh);
    table.appendChild(thead);

    var tbody = document.createElement('tbody');
    g.rows.forEach(function(row, i){
      var tr = document.createElement('tr');
      tr.appendChild(el('td', {class:'elem-col-idx', text:String(i+1)}));
      columns.forEach(function(col){
        var v = cellValue(row, col);
        var isNum = state.dimCols.indexOf(col) !== -1;
        tr.appendChild(el('td', {class: v==='' ? 'empty' : (isNum ? 'num' : ''), text: v===''?'—':v}));
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    body.appendChild(table);
    groupEl.appendChild(body);
    return groupEl;
  }

  function render(){
    var container = document.getElementById('elemGroups');
    container.innerHTML = '';
    var query = document.getElementById('elemSearch').value.trim().toLowerCase();
    var columns = state.contextCols.concat(state.dimCols);

    var sections = buildHierarchy();
    var totalTypes = 0, shownGroups = 0;

    sections.forEach(function(sec){ sec.categories.forEach(function(cat){ totalTypes += cat.groups.length; }); });

    var sectionsToRender = [];
    sections.forEach(function(sec){
      var catsToRender = [];
      sec.categories.forEach(function(cat){
        var groups = cat.groups.filter(function(g){
          return !query || g.nome.toLowerCase().indexOf(query) !== -1;
        });
        if (groups.length) catsToRender.push({ label: cat.label, tag: cat.tag, groups: groups });
      });
      if (catsToRender.length) sectionsToRender.push({ label: sec.label, elemCount: sec.elemCount, categories: catsToRender });
    });

    document.getElementById('elemStatElems').textContent = state.rows.length;
    document.getElementById('elemStatTypes').textContent = totalTypes;
    document.getElementById('elemMetaElems').textContent = state.rows.length;
    document.getElementById('elemMetaTypes').textContent = totalTypes;

    if (sectionsToRender.length === 0){
      container.appendChild(el('div', {class:'elem-empty-state', text:'Nenhum grupo encontrado para esse filtro.'}));
      document.getElementById('elemStatGroupsShown').textContent = 0;
      return;
    }

    sectionsToRender.forEach(function(sec){
      var sectionEl = el('div', {class:'elem-section'});
      var sectionHead = el('div', {class:'elem-section-head'}, [
        el('span', {class:'elem-caret elem-section-caret', text:'▾'}),
        el('span', {class:'elem-tag', text:'TRAMO'}),
        el('h2', {text: sec.label}),
        el('span', {class:'elem-section-count', text: sec.elemCount + (sec.elemCount===1?' elemento':' elementos')})
      ]);
      sectionHead.addEventListener('click', function(){
        sectionEl.classList.toggle('elem-section-collapsed');
      });
      sectionEl.appendChild(sectionHead);

      sec.categories.forEach(function(cat){
        var subEl = el('div', {class:'elem-subsection'});
        var count = cat.groups.reduce(function(n,g){ return n + g.rows.length; }, 0);
        var labelText = cat.label + (cat.tag ? ' · ' + cat.tag : '');
        var subHead = el('div', {class:'elem-subsection-head'}, [
          el('span', {class:'elem-caret elem-subsection-caret', text:'▾'}),
          el('span', {class:'elem-sub-label', text: labelText}),
          el('span', {class:'elem-sub-count', text: '· ' + count + (count===1?' elemento':' elementos')})
        ]);
        subHead.addEventListener('click', function(){
          subEl.classList.toggle('elem-subsection-collapsed');
        });
        subEl.appendChild(subHead);
        var listEl = el('div', {class:'elem-group-list'});
        cat.groups.forEach(function(g){
          var groupKey = sec.label + '␟' + cat.label + '␟' + (cat.tag||'') + '␟' + g.id + '␟' + g.nome;
          listEl.appendChild(renderGroupCard(g, columns, groupKey));
          shownGroups++;
        });
        subEl.appendChild(listEl);
        sectionEl.appendChild(subEl);
      });

      container.appendChild(sectionEl);
    });

    document.getElementById('elemStatGroupsShown').textContent = shownGroups;
  }

  // ---------- clipboard ----------
  function copyText(text){
    if (navigator.clipboard && navigator.clipboard.writeText){
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function(resolve, reject){
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus(); ta.select();
      try { document.execCommand('copy'); resolve(); }
      catch(e){ reject(e); }
      document.body.removeChild(ta);
    });
  }

  function flashButton(btn, label){
    var original = btn.textContent;
    btn.classList.add('elem-copied');
    btn.textContent = label;
    setTimeout(function(){ btn.classList.remove('elem-copied'); btn.textContent = original; }, 1200);
  }

  function copyColumn(g, col, btn){
    var values = g.rows.map(function(r){ return cellValue(r, col); });
    copyText(values.join('\n'))
      .then(function(){ flashButton(btn, '✓'); })
      .catch(function(){ flashButton(btn, '✕'); });
  }

  function copyGroupDimensions(g){
    var lines = g.rows.map(function(row){
      return state.dimCols.map(function(c){ return cellValue(row, c); }).join('\t');
    });
    return copyText(lines.join('\n'));
  }

  // ---------- loading ----------
  function loadCSVText(text, filename){
    var parsed = parseCSV(text);
    _hierarchyCache = null; // novo arquivo -- descarta o agrupamento anterior
    state.rows = parsed.rows;
    state.dimCols = parsed.dimCols;
    state.contextCols = parsed.contextCols;
    state.allExpanded = false;
    document.getElementById('elemMetaFile').textContent = filename || 'dados carregados';
    document.getElementById('elemToolbar').style.display = 'flex';
    document.getElementById('elemEmptyState').style.display = 'none';
    document.getElementById('elemBtnToggleAll').textContent = 'Expandir tudo';
    document.getElementById('elemDropzone').classList.add('elem-compact');
    render();
  }

  function readFile(file){
    var reader = new FileReader();
    reader.onload = function(e){
      var text = e.target.result;
      // Alguns exports do SGE saem em ANSI/Windows-1252 em vez de UTF-8;
      // lidos como UTF-8 eles viram "PAVIMENTO ASF�LTICO". O caractere de
      // substituição denuncia isso, e aí relemos com a codificação certa.
      if (text.indexOf('\uFFFD') !== -1){
        var r2 = new FileReader();
        r2.onload = function(ev){ loadCSVText(ev.target.result, file.name); };
        r2.readAsText(file, 'windows-1252');
        return;
      }
      loadCSVText(text, file.name);
    };
    reader.readAsText(file, 'UTF-8');
  }

  // ---------- wiring ----------
  var dropzone = document.getElementById('elemDropzone');
  var fileInput = document.getElementById('elemFileInput');

  document.getElementById('elemBtnChoose').addEventListener('click', function(){ fileInput.click(); });
  dropzone.addEventListener('click', function(e){
    // O id verificado aqui era 'btnSample', que não existe mais desde que
    // todos os ids desta aba ganharam o prefixo "elem".
    if (e.target.closest('button')) return;
    fileInput.click();
  });
  fileInput.addEventListener('change', function(){
    if (fileInput.files && fileInput.files[0]) readFile(fileInput.files[0]);
  });
  ['dragenter','dragover'].forEach(function(evt){
    dropzone.addEventListener(evt, function(e){ e.preventDefault(); dropzone.classList.add('elem-drag'); });
  });
  ['dragleave','drop'].forEach(function(evt){
    dropzone.addEventListener(evt, function(e){ e.preventDefault(); dropzone.classList.remove('elem-drag'); });
  });
  dropzone.addEventListener('drop', function(e){
    var f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) readFile(f);
  });
  document.getElementById('elemBtnSample').addEventListener('click', function(ev){
    ev.stopPropagation();
    var sample = ELEMENTOS_SAMPLE_CSV || '';
    if (!sample){
      alert('Arquivo de exemplo nao encontrado (js/sample-data.js nao foi carregado).');
      return;
    }
    loadCSVText(sample, 'ELEMENTOS_SGE_EXPORTAR.csv (exemplo)');
  });

  // Debounce: cada tecla digitada reconstrói toda a árvore de grupos
  // (createElement por card) -- em bases grandes isso engasgava a digitação.
  // Mesmo helper já usado em 12-search-pontos.js.
  document.getElementById('elemSearch').addEventListener('input', debounce(render, 120));
  document.getElementById('elemBtnToggleAll').addEventListener('click', function(){
    state.allExpanded = !state.allExpanded;
    this.textContent = state.allExpanded ? 'Recolher tudo' : 'Expandir tudo';
    document.querySelectorAll('.elem-group').forEach(function(g){
      g.classList.toggle('elem-collapsed', !state.allExpanded);
    });
  });


})();

