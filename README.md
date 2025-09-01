# More Than Amsterdam

A Wasm application for planning multi-leg train day trips.
The scope of the application is to help users plan exploration days in the Netherlands.

![screenshot](/images/day_trip_example.png)

The application uses DuckDB (Wasm) to process and analyze train schedule open data from [Rijden de Treinen](https://www.rijdendetreinen.nl/en/open-data).
The user can select departure and arrival stations and time, with the possibility to start and end in the same train station.
Based on the layover time chosen, the application returns the possible multi-leg train trips one can make in a day.
The user has the option to select or deselect stations from the paths returned.

The ranking of the paths is based on the number of unique provinces visited and on the number of monuments registered in the municipality of the train station.
The monument data is provided by [CBS open data, Rijksmonumenten; regio (2025), 1965-2024](https://opendata.cbs.nl/statline/portal.html?_la=nl&_catalog=CBS&tableId=86109NED&_theme=440).
