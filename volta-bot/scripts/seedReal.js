// scripts/seedReal.js
// FULL RESET + REAL-FOOTBALLER SEED
//
//   node scripts/seedReal.js
//
// Wipes users.json / players.json / market.json / tournaments.json / counters.json
// and regenerates:
//   - ONE owner account "Oasis FC" (the configured OWNER_ID) with 50,000,000
//   - 550+ real footballers distributed across real AI clubs (e.g. Real Madrid,
//     Manchester City...). Each club's players are listed on the transfer market
//     under that club's real name.
//
// NOTE: run this while the bot is STOPPED so the bot doesn't overwrite the files.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const OWNER_ID = '2349011861051@s.whatsapp.net';

const CONSONANTS = 'BCDFGHJKLMNPQRSTVWZ';
const VOWELS = 'AEIOU';

// ─── real clubs + real squads ────────────────────────────────────────────────
// [name, positionCode, overall]  — positionCode: GK | DEF | MID | FWD
const CLUBS = [
  { club: 'Manchester City', country: 'England', base: 85, players: [
    ['Ederson', 'GK', 88], ['Stefan Ortega', 'GK', 81], ['Kyle Walker', 'DEF', 84],
    ['Ruben Dias', 'DEF', 88], ['John Stones', 'DEF', 85], ['Nathan Ake', 'DEF', 83],
    ['Josko Gvardiol', 'DEF', 84], ['Manuel Akanji', 'DEF', 83], ['Rodri', 'MID', 90],
    ['Kevin De Bruyne', 'MID', 90], ['Bernardo Silva', 'MID', 87], ['Phil Foden', 'MID', 88],
    ['Ilkay Gundogan', 'MID', 84], ['Jack Grealish', 'MID', 84], ['Kalvin Phillips', 'MID', 80],
    ['Cole Palmer', 'MID', 82], ['Jeremy Doku', 'FWD', 83], ['Riyad Mahrez', 'FWD', 85],
    ['Erling Haaland', 'FWD', 91], ['Julian Alvarez', 'FWD', 84], ['Sergio Gomez', 'DEF', 80],
    ['Rico Lewis', 'DEF', 80], ['Mateo Kovacic', 'MID', 83],
  ]},
  { club: 'Arsenal', country: 'England', base: 84, players: [
    ['Aaron Ramsdale', 'GK', 82], ['David Raya', 'GK', 83], ['Ben White', 'DEF', 83],
    ['William Saliba', 'DEF', 87], ['Gabriel Magalhaes', 'DEF', 85], ['Oleksandr Zinchenko', 'DEF', 82],
    ['Takehiro Tomiyasu', 'DEF', 81], ['Jurrien Timber', 'DEF', 81], ['Thomas Partey', 'MID', 83],
    ['Declan Rice', 'MID', 86], ['Martin Odegaard', 'MID', 87], ['Granit Xhaka', 'MID', 83],
    ['Kai Havertz', 'FWD', 83], ['Bukayo Saka', 'FWD', 87], ['Gabriel Martinelli', 'FWD', 84],
    ['Leandro Trossard', 'FWD', 83], ['Eddie Nketiah', 'FWD', 80], ['Fabio Vieira', 'MID', 80],
    ['Emile Smith Rowe', 'MID', 81], ['Reiss Nelson', 'FWD', 79], ['Cedric Soares', 'DEF', 78],
    ['Jakub Kiwior', 'DEF', 80],
  ]},
  { club: 'Liverpool', country: 'England', base: 85, players: [
    ['Alisson', 'GK', 89], ['Caoimhin Kelleher', 'GK', 80], ['Trent Alexander-Arnold', 'DEF', 86],
    ['Virgil van Dijk', 'DEF', 89], ['Ibrahima Konate', 'DEF', 83], ['Andy Robertson', 'DEF', 84],
    ['Joel Matip', 'DEF', 82], ['Joe Gomez', 'DEF', 81], ['Fabinho', 'MID', 84],
    ['Alexis Mac Allister', 'MID', 84], ['Dominik Szoboszlai', 'MID', 84], ['Thiago', 'MID', 85],
    ['Curtis Jones', 'MID', 81], ['Ryan Gravenberch', 'MID', 81], ['Mohamed Salah', 'FWD', 89],
    ['Luis Diaz', 'FWD', 84], ['Darwin Nunez', 'FWD', 83], ['Diogo Jota', 'FWD', 84],
    ['Cody Gakpo', 'FWD', 83], ['Harvey Elliott', 'MID', 82], ['Kostas Tsimikas', 'DEF', 79],
    ['Caoimhin Kelleher', 'GK', 80],
  ]},
  { club: 'Chelsea', country: 'England', base: 82, players: [
    ['Kepa Arrizabalaga', 'GK', 80], ['Robert Sanchez', 'GK', 80], ['Reece James', 'DEF', 84],
    ['Thiago Silva', 'DEF', 85], ['Benoit Badiashile', 'DEF', 81], ['Wesley Fofana', 'DEF', 81],
    ['Marc Cucurella', 'DEF', 81], ['Levi Colwill', 'DEF', 80], ['Enzo Fernandez', 'MID', 84],
    ['Moises Caicedo', 'MID', 83], ['Conor Gallagher', 'MID', 82], ['Mykhailo Mudryk', 'FWD', 82],
    ['Raheem Sterling', 'FWD', 84], ['Nicolas Jackson', 'FWD', 81], ['Cole Palmer', 'FWD', 82],
    ['Noni Madueke', 'FWD', 80], ['Romeo Lavia', 'MID', 80],     ['Ben Chilwell', 'DEF', 82],
    ['Malo Gusto', 'DEF', 80], ['Carney Chukwuemeka', 'MID', 79], ['Christopher Nkunku', 'FWD', 83],
    ['Axel Disasi', 'DEF', 81],
  ]},
  { club: 'Manchester United', country: 'England', base: 82, players: [
    ['David de Gea', 'GK', 84], ['Andre Onana', 'GK', 83], ['Aaron Wan-Bissaka', 'DEF', 80],
    ['Raphael Varane', 'DEF', 84], ['Lisandro Martinez', 'DEF', 84], ['Luke Shaw', 'DEF', 83],
    ['Diogo Dalot', 'DEF', 81], ['Victor Lindelof', 'DEF', 81], ['Casemiro', 'MID', 86],
    ['Christian Eriksen', 'MID', 82], ['Bruno Fernandes', 'MID', 86], ['Marcus Rashford', 'FWD', 87],
    ['Antony', 'FWD', 80], ['Jadon Sancho', 'FWD', 82], ['Anthony Martial', 'FWD', 82],
    ['Alejandro Garnacho', 'FWD', 81], ['Mason Mount', 'MID', 82], ['Fred', 'MID', 81],
    ['Tyrell Malacia', 'DEF', 79], ['Harry Maguire', 'DEF', 80], ['Scott McTominay', 'MID', 80],
    ['Rasmus Hojlund', 'FWD', 81],
  ]},
  { club: 'Tottenham', country: 'England', base: 83, players: [
    ['Hugo Lloris', 'GK', 83], ['Guglielmo Vicario', 'GK', 82], ['Cristian Romero', 'DEF', 84],
    ['Eric Dier', 'DEF', 80], ['Ben Davies', 'DEF', 80], ['Pedro Porro', 'DEF', 81],
    ['Destiny Udogie', 'DEF', 80], ['Emerson Royal', 'DEF', 79], ['Pierre-Emile Hojbjerg', 'MID', 83],
    ['James Maddison', 'MID', 85], ['Yves Bissouma', 'MID', 82], ['Pape Sarr', 'MID', 80],
    ['Dejan Kulusevski', 'FWD', 84], ['Heung-min Son', 'FWD', 88], ['Richarlison', 'FWD', 82],
    ['Brennan Johnson', 'FWD', 81], ['Timo Werner', 'FWD', 82], ['Rodrigo Bentancur', 'MID', 82],
    ['Ivan Perisic', 'DEF', 81], ['Oliver Skipp', 'MID', 79], ['Bryan Gil', 'FWD', 79],
    ['Ange Postecoglou', 'MID', 75],
  ]},
  { club: 'Newcastle United', country: 'England', base: 83, players: [
    ['Nick Pope', 'GK', 83], ['Martin Dubravka', 'GK', 80], ['Kieran Trippier', 'DEF', 84],
    ['Sven Botman', 'DEF', 83], ['Fabian Schar', 'DEF', 82], ['Dan Burn', 'DEF', 80],
    ['Matt Targett', 'DEF', 79], ['Emil Krafth', 'DEF', 78], ['Bruno Guimaraes', 'MID', 85],
    ['Joelinton', 'MID', 82], ['Sean Longstaff', 'MID', 80], ['Joe Willock', 'MID', 81],
    ['Alexander Isak', 'FWD', 84], ['Callum Wilson', 'FWD', 82], ['Anthony Gordon', 'FWD', 83],
    ['Miguel Almiron', 'FWD', 81], ['Harvey Barnes', 'FWD', 82], ['Sandro Tonali', 'MID', 83],
    ['Lewis Miley', 'MID', 78], ['Jamaal Lascelles', 'DEF', 79], ['Jacob Murphy', 'FWD', 79],
    ['Yankuba Minteh', 'FWD', 78],
  ]},
  { club: 'Aston Villa', country: 'England', base: 82, players: [
    ['Emiliano Martinez', 'GK', 86], ['Robin Olsen', 'GK', 78], ['Ezri Konsa', 'DEF', 82],
    ['Pau Torres', 'DEF', 83], ['Tyrone Mings', 'DEF', 81], ['Matty Cash', 'DEF', 80],
    ['Lucas Digne', 'DEF', 81], ['Diego Carlos', 'DEF', 81], ['Douglas Luiz', 'MID', 84],
    ['John McGinn', 'MID', 82], ['Boubacar Kamara', 'MID', 81], ['Youri Tielemans', 'MID', 81],
    ['Ollie Watkins', 'FWD', 85], ['Leon Bailey', 'FWD', 82], ['Moussa Diaby', 'FWD', 83],
    ['Jacob Ramsey', 'MID', 81], ['Emi Buendia', 'MID', 81], ['Jhon Duran', 'FWD', 80],
    ['Philippe Coutinho', 'MID', 82], ['Calum Chambers', 'DEF', 79], ['Alex Moreno', 'DEF', 80],
    ['Tim Iroegbunam', 'MID', 78],
  ]},
  { club: 'Brighton', country: 'England', base: 81, players: [
    ['Jason Steele', 'GK', 79], ['Bart Verbruggen', 'GK', 80], ['Lewis Dunk', 'DEF', 82],
    ['Adam Webster', 'DEF', 80], ['Joel Veltman', 'DEF', 80], ['Pervis Estupinan', 'DEF', 82],
    ['Tariq Lamptey', 'DEF', 80], ['Jan Paul van Hecke', 'DEF', 80], ['Pascal Gross', 'MID', 83],
    ['Alexis Mac Allister', 'MID', 84], ['Moises Caicedo', 'MID', 83], ['Carlos Baleba', 'MID', 79],
    ['Kaoru Mitoma', 'FWD', 83], ['Simon Adingra', 'FWD', 80], ['Evan Ferguson', 'FWD', 81],
    ['Joao Pedro', 'FWD', 82], ['Danny Welbeck', 'FWD', 80], ['Solly March', 'MID', 81],
    ['Billy Gilmour', 'MID', 80], ['Julio Enciso', 'FWD', 80], ['James Milner', 'MID', 79],
    ['Igor Julio', 'DEF', 80],
  ]},
  { club: 'West Ham', country: 'England', base: 80, players: [
    ['Alphonse Areola', 'GK', 81], ['Lukasz Fabianski', 'GK', 79], ['Kurt Zouma', 'DEF', 81],
    ['Nayef Aguerd', 'DEF', 80], ['Thilo Kehrer', 'DEF', 79], ['Aaron Cresswell', 'DEF', 80],
    ['Vladimir Coufal', 'DEF', 79], ['Emerson', 'DEF', 80], ['Declan Rice', 'MID', 86],
    ['Tomas Soucek', 'MID', 81], ['Lucas Paqueta', 'MID', 84], ['James Ward-Prowse', 'MID', 82],
    ['Jarrod Bowen', 'FWD', 84], ['Michail Antonio', 'FWD', 81], ['Said Benrahma', 'FWD', 80],
    ['Mohammed Kudus', 'FWD', 82], ['Maxwel Cornet', 'FWD', 78], ['Pablo Fornals', 'MID', 81],
    ['Konstantinos Mavropanos', 'DEF', 80], ['George Earthy', 'MID', 77], ['Ben Johnson', 'DEF', 79],
    ['Danny Ings', 'FWD', 80],
  ]},
  { club: 'Real Madrid', country: 'Spain', base: 89, players: [
    ['Thibaut Courtois', 'GK', 89], ['Andriy Lunin', 'GK', 82], ['Dani Carvajal', 'DEF', 84],
    ['Eder Militao', 'DEF', 86], ['David Alaba', 'DEF', 85], ['Antonio Rudiger', 'DEF', 85],
    ['Ferland Mendy', 'DEF', 82], ['Nacho', 'DEF', 83], ['Federico Valverde', 'MID', 86],
    ['Luka Modric', 'MID', 87], ['Toni Kroos', 'MID', 87], ['Eduardo Camavinga', 'MID', 85],
    ['Aurelien Tchouameni', 'MID', 84], ['Jude Bellingham', 'MID', 88], ['Vinicius Junior', 'FWD', 89],
    ['Rodrygo', 'FWD', 86], ['Kylian Mbappe', 'FWD', 91], ['Joselu', 'FWD', 81],
    ['Brahim Diaz', 'FWD', 82], ['Arda Guler', 'MID', 81], ['Fran Garcia', 'DEF', 80],
    ['Endrick', 'FWD', 80],
  ]},
  { club: 'Barcelona', country: 'Spain', base: 87, players: [
    ['Marc-Andre ter Stegen', 'GK', 88], ['Inaki Pena', 'GK', 79], ['Jules Kounde', 'DEF', 84],
    ['Ronald Araujo', 'DEF', 86], ['Andreas Christensen', 'DEF', 83], ['Alejandro Balde', 'DEF', 83],
    ['Marcos Alonso', 'DEF', 80], ['Eric Garcia', 'DEF', 79], ['Frenkie de Jong', 'MID', 86],
    ['Pedri', 'MID', 87], ['Gavi', 'MID', 85], ['Ilkay Gundogan', 'MID', 84],
    ['Oriol Romeu', 'MID', 80], ['Robert Lewandowski', 'FWD', 88], ['Raphinha', 'FWD', 84],
    ['Ferran Torres', 'FWD', 82], ['Ansu Fati', 'FWD', 81], ['Lamine Yamal', 'FWD', 82],
    ['Joao Felix', 'FWD', 83], ['Marc Guiu', 'FWD', 78], ['Inigo Martinez', 'DEF', 82],
    ['Fermin Lopez', 'MID', 81],
  ]},
  { club: 'Atletico Madrid', country: 'Spain', base: 85, players: [
    ['Jan Oblak', 'GK', 89], ['Ivo Grbic', 'GK', 78], ['Jose Gimenez', 'DEF', 84],
    ['Stefan Savic', 'DEF', 82], ['Mario Hermoso', 'DEF', 82], ['Reinildo', 'DEF', 81],
    ['Nahuel Molina', 'DEF', 82], ['Cesar Azpilicueta', 'DEF', 81], ['Koke', 'MID', 83],
    ['Marcos Llorente', 'MID', 84], ['Rodrigo De Paul', 'MID', 83], ['Saul', 'MID', 81],
    ['Thomas Lemar', 'MID', 81], ['Antoine Griezmann', 'FWD', 87], ['Alvaro Morata', 'FWD', 84],
    ['Joao Felix', 'FWD', 83], ['Memphis Depay', 'FWD', 82], ['Angel Correa', 'FWD', 81],
    ['Samuel Lino', 'FWD', 80], ['Pablo Barrios', 'MID', 79], ['Axel Witsel', 'DEF', 82],
    ['Giuliano Simeone', 'FWD', 78],
  ]},
  { club: 'Sevilla', country: 'Spain', base: 81, players: [
    ['Yassine Bounou', 'GK', 85], ['Marko Dmitrovic', 'GK', 79], ['Jesus Navas', 'DEF', 81],
    ['Marcos Acuna', 'DEF', 82], ['Loic Bade', 'DEF', 81], ['Tanguy Nianzou', 'DEF', 80],
    ['Gonzalo Montiel', 'DEF', 80], ['Sergio Ramos', 'DEF', 83], ['Fernando', 'MID', 82],
    ['Ivan Rakitic', 'MID', 83], ['Joan Jordan', 'MID', 81], ['Lucas Ocampos', 'FWD', 82],
    ['Youssef En-Nesyri', 'FWD', 82], ['Erik Lamela', 'MID', 80], ['Bryan Gil', 'FWD', 79],
    ['Dodi Lukebakio', 'FWD', 80], ['Susso', 'MID', 80], ['Nemanja Gudelj', 'MID', 80],
    ['Adnan Januzaj', 'FWD', 79], ['Rafa Mir', 'FWD', 79], ['Isaac Romero', 'FWD', 77],
    ['Jose Angel Carmona', 'DEF', 78],
  ]},
  { club: 'Real Betis', country: 'Spain', base: 81, players: [
    ['Claudio Bravo', 'GK', 80], ['Rui Silva', 'GK', 80], ['German Pezzella', 'DEF', 81],
    ['Aissa Mandi', 'DEF', 80], ['Marc Bartra', 'DEF', 81], ['Hector Bellerin', 'DEF', 80],
    ['Juan Miranda', 'DEF', 79], ['Abner', 'DEF', 79], ['Guido Rodriguez', 'MID', 81],
    ['Sergio Canales', 'MID', 83], ['Isco', 'MID', 83], ['Aitor Ruibal', 'FWD', 78],
    ['Nabil Fekir', 'FWD', 83], ['Borja Iglesias', 'FWD', 81], ['Willian Jose', 'FWD', 80],
    ['Rodrigo Riquelme', 'MID', 80], ['Assane Diao', 'FWD', 77], ['Johnny Cardoso', 'MID', 80],
    ['Pablo Fornals', 'MID', 81], ['Youssouf Sabaly', 'DEF', 79], ['Romain Perraud', 'DEF', 79],
    ['Chimy Avila', 'FWD', 79],
  ]},
  { club: 'Juventus', country: 'Italy', base: 83, players: [
    ['Wojciech Szczesny', 'GK', 83], ['Mattia Perin', 'GK', 80], ['Gleison Bremer', 'DEF', 84],
    ['Federico Gatti', 'DEF', 81], ['Danilo', 'DEF', 83], ['Alex Sandro', 'DEF', 81],
    ['Juan Cuadrado', 'DEF', 82], ['Andrea Cambiaso', 'DEF', 80], ['Manuel Locatelli', 'MID', 82],
    ['Adrien Rabiot', 'MID', 83], ['Paul Pogba', 'MID', 85], ['Fabio Miretti', 'MID', 80],
    ['Weston McKennie', 'MID', 81], ['Dusan Vlahovic', 'FWD', 85], ['Federico Chiesa', 'FWD', 84],
    ['Moise Kean', 'FWD', 81], ['Arkadiusz Milik', 'FWD', 81], ['Filip Kostic', 'MID', 82],
    ['Samuel Iling-Junior', 'FWD', 78], ['Dejan Kulusevski', 'FWD', 84], ['Timothy Weah', 'FWD', 79],
    ['Nicolo Fagioli', 'MID', 80],
  ]},
  { club: 'Inter Milan', country: 'Italy', base: 85, players: [
    ['Andre Onana', 'GK', 83], ['Yann Sommer', 'GK', 83], ['Milan Skriniar', 'DEF', 85],
    ['Francesco Acerbi', 'DEF', 82], ['Stefan de Vrij', 'DEF', 83], ['Alessandro Bastoni', 'DEF', 84],
    ['Denzel Dumfries', 'DEF', 82], ['Federico Dimarco', 'DEF', 82], ['Nicolo Barella', 'MID', 86],
    ['Hakan Calhanoglu', 'MID', 85], ['Marcelo Brozovic', 'MID', 84], ['Henrikh Mkhitaryan', 'MID', 82],
    ['Davide Frattesi', 'MID', 81], ['Lautaro Martinez', 'FWD', 88], ['Marcus Thuram', 'FWD', 83],
    ['Edin Dzeko', 'FWD', 82], ['Joaquin Correa', 'FWD', 80], ['Roberto Gagliardini', 'MID', 80],
    ['Stefan Sensi', 'MID', 79], ['Kristjan Asllani', 'MID', 79], ['Carlos Augusto', 'DEF', 80],
    ['Tajon Buchanan', 'FWD', 78],
  ]},
  { club: 'AC Milan', country: 'Italy', base: 84, players: [
    ['Mike Maignan', 'GK', 86], ['Ciprian Tatarusanu', 'GK', 78], ['Fikayo Tomori', 'DEF', 84],
    ['Pierre Kalulu', 'DEF', 81], ['Simon Kjaer', 'DEF', 82], ['Malick Thiaw', 'DEF', 81],
    ['Theo Hernandez', 'DEF', 85], ['Davide Calabria', 'DEF', 82], ['Ismael Bennacer', 'MID', 83],
    ['Sandro Tonali', 'MID', 83], ['Ruben Loftus-Cheek', 'MID', 81], ['Tijjani Reijnders', 'MID', 81],
    ['Yacine Adli', 'MID', 80], ['Rafael Leao', 'FWD', 86], ['Olivier Giroud', 'FWD', 83],
    ['Christian Pulisic', 'FWD', 83], ['Ruben Dias', 'DEF', 88], ['Noah Okafor', 'FWD', 80],
    ['Luka Jovic', 'FWD', 81], ['Alexis Saelemaekers', 'MID', 80], ['Fode Ballo-Toure', 'DEF', 78],
    ['Marco Sportiello', 'GK', 78],
  ]},
  { club: 'Napoli', country: 'Italy', base: 85, players: [
    ['Alex Meret', 'GK', 81], ['Pierluigi Gollini', 'GK', 78], ['Giovanni Di Lorenzo', 'DEF', 84],
    ['Amir Rrahmani', 'DEF', 81], ['Kim Min-jae', 'DEF', 85], ['Mario Rui', 'DEF', 81],
    ['Mathias Olivera', 'DEF', 80], ['Leo Ostigard', 'DEF', 80], ['Stanislav Lobotka', 'MID', 84],
    ['Piotr Zielinski', 'MID', 83], ['Andre-Frank Zambo Anguissa', 'MID', 83], ['Giovanni Simeone', 'FWD', 80],
    ['Victor Osimhen', 'FWD', 87], ['Khvicha Kvaratskhelia', 'FWD', 87], ['Hirving Lozano', 'FWD', 81],
    ['Matteo Politano', 'FWD', 81], ['Giacomo Raspadori', 'FWD', 82], ['Eljif Elmas', 'MID', 80],
    ['Tanguy Ndombele', 'MID', 81], ['Jens Cajuste', 'MID', 79], ['Mário Rui', 'DEF', 81],
    ['Alessio Zerbin', 'FWD', 77],
  ]},
  { club: 'AS Roma', country: 'Italy', base: 82, players: [
    ['Rui Patricio', 'GK', 81], ['Mile Svilar', 'GK', 79], ['Gianluca Mancini', 'DEF', 82],
    ['Chris Smalling', 'DEF', 82], ['Roger Ibanez', 'DEF', 82], ['Leonardo Spinazzola', 'DEF', 81],
    ['Rick Karsdorp', 'DEF', 80], ['Diego Llorente', 'DEF', 80], ['Lorenzo Pellegrini', 'MID', 83],
    ['Bryan Cristante', 'MID', 81], ['Nicolò Mancini', 'MID', 79], ['Paulo Dybala', 'FWD', 85],
    ['Tammy Abraham', 'FWD', 82], ['Andrea Belotti', 'FWD', 80], ['Nicolo Zaniolo', 'FWD', 82],
    ['Stephan El Shaarawy', 'FWD', 81], ['Edoardo Bove', 'MID', 78], ['Mady Camara', 'MID', 79],
    ['Zeki Celik', 'DEF', 80], ['Ebrima Darboe', 'MID', 78], ['Felix Afena-Gyan', 'FWD', 77],
    ['Nicolo Pisilli', 'MID', 76],
  ]},
  { club: 'Bayern Munich', country: 'Germany', base: 88, players: [
    ['Manuel Neuer', 'GK', 88], ['Sven Ulreich', 'GK', 79], ['Benjamin Pavard', 'DEF', 83],
    ['Dayot Upamecano', 'DEF', 84], ['Matthijs de Ligt', 'DEF', 84], ['Alphonso Davies', 'DEF', 85],
    ['Noussair Mazraoui', 'DEF', 81], ['Luca Hernandez', 'DEF', 84], ['Joshua Kimmich', 'MID', 88],
    ['Leon Goretzka', 'MID', 85], ['Jamal Musiala', 'MID', 88], ['Thomas Muller', 'FWD', 84],
    ['Kingsley Coman', 'FWD', 84], ['Serge Gnabry', 'FWD', 84], ['Leroy Sane', 'FWD', 86],
    ['Harry Kane', 'FWD', 90], ['Eric Choupo-Moting', 'FWD', 81], ['Ryan Gravenberch', 'MID', 81],
    ['Mathys Tel', 'FWD', 80], ['Konrad Laimer', 'MID', 81], ['Daley Blind', 'DEF', 80],
    ['Gabriel Maripan', 'DEF', 80],
  ]},
  { club: 'Borussia Dortmund', country: 'Germany', base: 85, players: [
    ['Gregor Kobel', 'GK', 84], ['Alexander Meyer', 'GK', 78], ['Raphael Guerreiro', 'DEF', 83],
    ['Nico Schlotterbeck', 'DEF', 83], ['Mats Hummels', 'DEF', 85], ['Niklas Sule', 'DEF', 83],
    ['Julian Ryerson', 'DEF', 80], ['Thomas Meunier', 'DEF', 79], ['Jude Bellingham', 'MID', 88],
    ['Emre Can', 'MID', 82], ['Felix Nmecha', 'MID', 80], ['Marco Reus', 'FWD', 85],
    ['Julian Brandt', 'MID', 84], ['Karim Adeyemi', 'FWD', 83], ['Youssoufa Moukoko', 'FWD', 81],
    ['Sebastien Haller', 'FWD', 82], ['Donyell Malen', 'FWD', 82], ['Giovanni Reyna', 'MID', 81],
    ['Salih Ozcan', 'MID', 80], ['Marius Wolf', 'DEF', 78], ['Ramon Machado', 'DEF', 78],
    ['Jamie Bynoe-Gittens', 'FWD', 79],
  ]},
  { club: 'Bayer Leverkusen', country: 'Germany', base: 85, players: [
    ['Lukas Hradecky', 'GK', 83], ['Matej Kovar', 'GK', 78], ['Jonathan Tah', 'DEF', 84],
    ['Edmond Tapsoba', 'DEF', 83], ['Piero Hincapie', 'DEF', 83], ['Mitchel Bakker', 'DEF', 80],
    ['Jeremie Frimpong', 'DEF', 83], ['Odilon Kossounou', 'DEF', 81], ['Granit Xhaka', 'MID', 84],
    ['Exequiel Palacios', 'MID', 82], ['Florian Wirtz', 'MID', 87], ['Robert Andrich', 'MID', 81],
    ['Amine Adli', 'FWD', 81], ['Moussa Diaby', 'FWD', 83], ['Victor Boniface', 'FWD', 83],
    ['Patrik Schick', 'FWD', 83], ['Adam Hlozek', 'FWD', 81], ['Nathan Tella', 'FWD', 80],
    ['Piero Hincapie', 'DEF', 83], ['Charles Aranguiz', 'MID', 81], ['Alejandro Grimaldo', 'DEF', 81],
    ['Jonas Hofmann', 'MID', 84],
  ]},
  { club: 'RB Leipzig', country: 'Germany', base: 84, players: [
    ['Peter Gulacsi', 'GK', 83], ['Janis Blaswich', 'GK', 79], ['Mohamed Simakan', 'DEF', 82],
    ['Willi Orban', 'DEF', 82], ['Castello Lukeba', 'DEF', 81], ['Benjamin Henrichs', 'DEF', 80],
    ['David Raum', 'DEF', 82], ['Lukas Klostermann', 'DEF', 80], ['Konrad Laimer', 'MID', 81],
    ['Amadou Haidara', 'MID', 81], ['Xaver Schlager', 'MID', 81], ['Dominik Szoboszlai', 'MID', 84],
    ['Christopher Nkunku', 'FWD', 86], ['Timo Werner', 'FWD', 82], ['Lois Openda', 'FWD', 83],
    ['Emil Forsberg', 'MID', 83], ['Dani Olmo', 'MID', 84], ['Yussuf Poulsen', 'FWD', 81],
    ['Andre Silva', 'FWD', 81], ['Nicolas Seiwald', 'MID', 80], ['Josko Gvardiol', 'DEF', 84],
    ['Kevin Kampl', 'MID', 80],
  ]},
  { club: 'Paris Saint-Germain', country: 'France', base: 87, players: [
    ['Gianluigi Donnarumma', 'GK', 87], ['Keylor Navas', 'GK', 81], ['Achraf Hakimi', 'DEF', 85],
    ['Marquinhos', 'DEF', 86], ['Sergio Ramos', 'DEF', 83], ['Presnel Kimpembe', 'DEF', 83],
    ['Nuno Mendes', 'DEF', 83], ['Lucas Hernandez', 'DEF', 83], ['Marco Verratti', 'MID', 86],
    ['Vitnha', 'MID', 84], ['Warren Zaire-Emery', 'MID', 82], ['Fabian Ruiz', 'MID', 82],
    ['Kylian Mbappe', 'FWD', 91], ['Neymar', 'FWD', 88], ['Ousmane Dembele', 'FWD', 84],
    ['Goncalo Ramos', 'FWD', 82], ['Randal Kolo Muani', 'FWD', 83], ['Lee Kang-in', 'MID', 81],
    ['Bradley Barcola', 'FWD', 80], ['Renato Sanches', 'MID', 80], ['Danilo Pereira', 'MID', 81],
    ['Milan Skriniar', 'DEF', 85],
  ]},
  { club: 'Marseille', country: 'France', base: 81, players: [
    ['Pau Lopez', 'GK', 81], ['Rubén Blanco', 'GK', 78], ['Chancel Mbemba', 'DEF', 82],
    ['Samuel Gigot', 'DEF', 81], ['Leonardo Balerdi', 'DEF', 80], ['Jonathan Clauss', 'DEF', 82],
    ['Nuno Tavares', 'DEF', 80], ['Pol Lirola', 'DEF', 79], ['Valentin Rongier', 'MID', 81],
    ['Jordan Veretout', 'MID', 82], ['Ismaila Sarr', 'FWD', 82], ['Cengiz Under', 'FWD', 80],
    ['Pierre-Emerick Aubameyang', 'FWD', 84], ['Vitinha', 'FWD', 80], ['Iliman Ndiaye', 'FWD', 81],
    ['Azzedine Ounahi', 'MID', 80], ['Rogelio', 'DEF', 78], ['Bamba Dieng', 'FWD', 78],
    ['Franck Zambada', 'MID', 77], ['Luiz Henrique', 'FWD', 79], ['Chamseddine Harit', 'MID', 80],
    ['Bilal Nadir', 'MID', 77],
  ]},
];

// Owner's personal stars (also counted toward the 550+ real footballers)
const OWNER_STARS = [
  ['Lionel Messi', 'FWD', 93],
  ['Cristiano Ronaldo', 'FWD', 90],
  ['Kevin De Bruyne', 'MID', 90],
  ['Alisson', 'GK', 89],
];

// ─── helpers ──────────────────────────────────────────────────────────────────
function randInt(a, b) { return Math.floor(Math.random() * (b - a + 1)) + a; }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

const usedIds = new Set();
function genId() {
  for (let i = 0; i < 80; i++) {
    const id = pick(CONSONANTS.split('')) + pick(VOWELS.split('')) + pick(CONSONANTS.split(''));
    if (!usedIds.has(id)) { usedIds.add(id); return id; }
  }
  let id;
  do { id = pick(CONSONANTS.split('')) + pick(VOWELS.split('')) + pick(CONSONANTS.split('')) + randInt(0, 9); }
  while (usedIds.has(id));
  usedIds.add(id);
  return id;
}

function rarityFromOvr(ovr) {
  if (ovr >= 90) return 'Legendary';
  if (ovr >= 83) return 'Elite';
  if (ovr >= 73) return 'Rare';
  return 'Common';
}
const RARITY_BONUS = { Common: 0, Rare: 200, Elite: 600, Legendary: 2000 };
const ROLE_BY_POS = { GK: 'goalkeeper', DEF: 'outfield', MID: 'outfield', FWD: 'outfield' };

function statsFor(role, ovr) {
  const v = () => clamp(ovr + randInt(-6, 6), 40, 99);
  if (role === 'goalkeeper') {
    return { reflex: v(), positioning: v(), anticipation: v(), strength: v(), composure: v() };
  }
  return { pace: v(), skill: v(), shooting: v(), stamina: v(), composure: v() };
}

function slug(club) { return 'club:' + club.toLowerCase().replace(/[^a-z0-9]+/g, '_'); }

function newPlayerDoc({ ownerId, name, role, rarity, ovr, position, nationality }) {
  const stats = statsFor(role, ovr);
  const total = Object.values(stats).reduce((a, b) => a + b, 0);
  const marketValue = Math.round(total + (RARITY_BONUS[rarity] || 0));
  return {
    id: genId(),
    ownerId,
    name,
    nickname: null,
    role,
    rarity,
    potential: ovr >= 85 ? 'Star' : ovr >= 78 ? 'High' : 'Medium',
    level: 1,
    stats,
    position: position || null,
    condition: 100,
    form: 'Normal',
    chemistry: 0,
    isListed: false,
    marketPrice: 0,
    isAI: ownerId.startsWith('club:'),
    matchesPlayed: 0,
    goals: 0,
    assists: 0,
    saves: 0,
    manOfTheMatch: 0,
    nationality: nationality || 'Unknown',
    age: randInt(18, 34),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

// ─── build players + market ────────────────────────────────────────────────────
const players = {};
const market = {};
let count = 0;

function addPlayer(doc, listOnMarket, sellerId, sellerName) {
  players[doc.id] = doc;
  count++;
  if (listOnMarket) {
    const marketValue = doc.marketPrice || Math.round(
      Object.values(doc.stats).reduce((a, b) => a + b, 0) + (RARITY_BONUS[doc.rarity] || 0)
    );
    const price = Math.round(marketValue * (0.5 + Math.random() * 0.8));
    const listingId = crypto.randomUUID();
    market[listingId] = {
      id: listingId,
      playerId: doc.id,
      sellerId,
      sellerName,
      price,
      listedAt: new Date().toISOString(),
      sold: false,
    };
    doc.isListed = true;
    doc.marketPrice = price;
  }
}

// Owner stars (NOT listed on market; form the owner's squad)
const ownerSquadIds = [];
for (const [name, pos, ovr] of OWNER_STARS) {
  const role = ROLE_BY_POS[pos];
  const doc = newPlayerDoc({ ownerId: OWNER_ID, name, role, rarity: rarityFromOvr(ovr), ovr, position: pos, nationality: 'World' });
  addPlayer(doc, false);
  ownerSquadIds.push(doc.id);
}

// AI club players (listed on market under the real club name)
for (const { club, country, base, players: squad } of CLUBS) {
  const sellerId = slug(club);
  for (const [name, pos, ovrRaw] of squad) {
    const ovr = ovrRaw || clamp(base + randInt(-4, 6), 60, 95);
    const role = ROLE_BY_POS[pos];
    const doc = newPlayerDoc({ ownerId: sellerId, name, role, rarity: rarityFromOvr(ovr), ovr, position: pos, nationality: country });
    addPlayer(doc, true, sellerId, club);
  }
}

// ─── owner user ────────────────────────────────────────────────────────────────
const now = new Date().toISOString();
const users = {
  [OWNER_ID]: {
    whatsappId: OWNER_ID,
    name: 'Oasis FC',
    currency: 50000000,
    startingXI: ownerSquadIds.slice(0, 4),
    bench: ownerSquadIds.slice(4),
    reserves: [],
    savedSquads: [],
    mmr: 1000,
    rank: 'Bronze',
    wins: 0, losses: 0, draws: 0, totalGoals: 0,
    lastDaily: null, dailyStreak: 0,
    inMatch: false, currentMatchId: null,
    registered: true,
    role: 'user',
    warnings: 0, bannedUntil: null,
    createdAt: now, updatedAt: now,
  },
};

// ─── write everything ──────────────────────────────────────────────────────────
fs.writeFileSync(path.join(DATA_DIR, 'users.json'), JSON.stringify(users, null, 2));
fs.writeFileSync(path.join(DATA_DIR, 'players.json'), JSON.stringify(players, null, 2));
fs.writeFileSync(path.join(DATA_DIR, 'market.json'), JSON.stringify(market, null, 2));
fs.writeFileSync(path.join(DATA_DIR, 'tournaments.json'), JSON.stringify({}, null, 2));
fs.writeFileSync(path.join(DATA_DIR, 'counters.json'), JSON.stringify({}, null, 2));

console.log(`[SEED] Done.`);
console.log(`  users:     ${Object.keys(users).length} (Oasis FC owner, 50M)`);
console.log(`  players:   ${count} real footballers`);
console.log(`  clubs:     ${CLUBS.length} real AI clubs`);
console.log(`  listings:  ${Object.keys(market).length} on the transfer market`);
