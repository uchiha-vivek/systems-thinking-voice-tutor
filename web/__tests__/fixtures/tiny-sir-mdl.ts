// A small hand-built Vensim (.mdl) model in the same shape Vensim saves: the SIR model from
// tiny-sir.ts plus a named lookup. String.raw keeps the file's backslashes as written.
export const TINY_SIR_MDL = String.raw`{UTF-8}
Susceptible Population S= INTEG (
	-Infection Rate,
		Total Population N-1)
	~	People
	~	People who can still catch it.
	|

Infected Population I= INTEG (
	Infection Rate-Recovery Rate,
		1)
	~	People
	~		|

Infection Rate=
	Contact Rate*Susceptible Population S*Infected Population I\
		/Total Population N
	~	People/Day
	~	New infections each day.
	|

Recovery Rate=
	Infected Population I/"Recovery Time"
	~	People/Day
	~		|

Contact Rate=
	0.5
	~	1/Day
	~		|

Total Population N=
	1000
	~	People
	~		|

Recovery Time=
	7
	~	Day
	~		|

Crowding Effect=
	WITH LOOKUP (Infected Population I,
		([(0,0)-(1000,1)],(0,1),(300,0.8),(600,0.4),(1000,0.1) ))
	~	Dmnl
	~	How crowded the clinics feel.
	|

Distancing Lookup(
	[(0,0)-(1,1)],(0,0),(0.2,0.3),(0.5,0.8),(1,1))
	~	Dmnl
	~		|

Distancing=
	IF THEN ELSE(Time > 5 :AND: Contact Rate > 0,\
		Distancing Lookup(Infected Population I/Total Population N), 0)
	~	Dmnl
	~		|

********************************************************
	.Control
********************************************************~
		Simulation Control Parameters
	|

FINAL TIME  = 50
	~	Day
	~	The final time for the simulation.
	|

INITIAL TIME  = 0
	~	Day
	~	The initial time for the simulation.
	|

SAVEPER  =
        TIME STEP
	~	Day [0,?]
	~	The frequency with which output is stored.
	|

TIME STEP  = 0.25
	~	Day [0,?]
	~	The time step for the simulation.
	|

\\\---/// Sketch information - do not modify anything except names
V300  Do not put anything below this section - it will be ignored
*Tiny SIR model
$192-192-192,0,Times New Roman|12||0-0-0|0-0-0|0-0-255|-1--1--1|-1--1--1|96,96,100,0
10,1,Susceptible Population S,300,200,40,20,3,3,0,0,0,0,0,0
10,2,Infected Population I,600,200,40,20,3,3,0,0,0,0,0,0
11,3,0,450,200,6,8,34,3,0,0,1,0,0,0
10,4,Infection Rate,450,225,30,11,40,3,0,0,-1,0,0,0
1,5,3,2,4,0,0,22,0,0,0,-1--1--1,,1|(525,200)|
1,6,3,1,100,0,0,22,0,0,0,-1--1--1,,1|(375,200)|
12,7,48,820,200,10,8,0,3,0,0,-1,0,0,0
11,8,0,720,200,6,8,34,3,0,0,1,0,0,0
10,9,Recovery Rate,720,225,30,11,40,3,0,0,-1,0,0,0
1,10,8,7,4,0,0,22,0,0,0,-1--1--1,,1|(770,200)|
1,11,8,2,100,0,0,22,0,0,0,-1--1--1,,1|(670,200)|
10,12,Contact Rate,360,320,30,11,8,3,0,0,0,0,0,0
10,13,Total Population N,500,360,40,11,8,3,0,0,0,0,0,0
10,14,Recovery Time,780,320,30,11,8,3,0,0,0,0,0,0
10,15,Crowding Effect,650,80,30,11,8,3,0,0,0,0,0,0
10,16,Contact Rate,550,420,30,11,8,2,0,3,-1,0,0,0,128-128-128,0-0-0,|12||128-128-128
1,17,12,3,0,0,43,0,0,64,0,-1--1--1,,1|(400,260)|
1,18,13,4,0,0,0,0,0,64,0,-1--1--1,,1|(480,300)|
1,19,1,4,0,0,0,0,0,64,0,-1--1--1,,1|(380,240)|
1,20,2,4,0,0,0,0,0,64,0,-1--1--1,,1|(520,240)|
1,21,2,9,0,0,0,0,0,64,0,-1--1--1,,1|(660,240)|
1,22,14,9,0,0,45,0,0,64,0,-1--1--1,,1|(750,270)|
1,23,2,15,0,0,0,0,0,64,0,-1--1--1,,1|(620,140)|
12,24,0,520,150,15,15,5,135,0,0,-1,0,0,0
R
12,25,0,700,150,15,15,4,135,0,0,-1,0,0,0
B
12,26,0,300,450,80,20,3,188,0,0,0,0,0,0
Adapted from a classroom example
///---\\\
:L<%^E!@
1:Current.vdfx
9:Current
15:0,0,0,0,0,0
19:100,0
27:0,
34:0,
5:Infected Population I
`;
