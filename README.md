# morethanamsterdam-web

A web application for planning train day trips in The Netherlands.
The application uses DuckDB to process and analyze train schedule data from [Rijden de Treinen](https://www.rijdendetreinen.nl/en/open-data) open data, helping users discover inter-city train connections for day trips between different municipalities.

The ranking of the returned suggestions is based on the number of unique provinces visited and on the number of monuments registered in the municipality of the train station.
The monument data is provided by [CBS open data, Rijksmonumenten; regio (2025), 1965-2024](https://opendata.cbs.nl/statline/portal.html?_la=nl&_catalog=CBS&tableId=86109NED&_theme=440).

