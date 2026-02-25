# People_Co_national-budget
making goverment transparrent on national budget so people can decide what they want
# Collective National Budget

A civic engagement web application that lets citizens express how they'd allocate the national budget. The pie chart shows the **collective average** of all participants' choices. Users can log in to adjust their own personal allocations, which contribute to the overall picture.

## Quick Start

```bash
docker-compose up --build
```

Then open [http://localhost:8080](http://localhost:8080).

**Demo credentials:** `demo` / `demo123`

## Features

- **Interactive pie chart** with drill-down navigation into sub-categories
- **Editable legend** — type percentages directly or drag pie slices
- **Proportional adjustment** — changing one slice redistributes others so the total always stays at 100%
- **Collective view** shows the average of all participants' allocations
- **Colorblind-accessible** palette (Okabe-Ito)
- **Breadcrumb navigation** for the budget category tree

## Architecture

| Layer      | Technology            |
|------------|-----------------------|
| Database   | PostgreSQL 15         |
| Backend    | Perl 5.36 / Mojolicious |
| Frontend   | HTML5, Chart.js 4, chartjs-plugin-dragdata |
| Container  | Docker / Docker Compose |

## Project Structure

```
national-budget-app/
├── docker-compose.yml
├── backend/
│   ├── Dockerfile
│   ├── cpanfile          # Perl dependencies
│   ├── app.pl            # Mojolicious REST API
│   └── templates/
│       └── index.html.ep # Main HTML template
├── db/
│   └── init.sql          # Schema + seed data
└── public/
    ├── css/style.css
    └── js/budget.js      # Chart + proportional math
```

## API Endpoints

| Method | Path                          | Description                        |
|--------|-------------------------------|------------------------------------|
| GET    | `/api/tree/:parent_id`        | Children of a node (?mode=view/edit) |
| GET    | `/api/tree/:id/has_children`  | Check if node has sub-categories   |
| GET    | `/api/node/:id`               | Single node info                   |
| GET    | `/api/breadcrumbs/:id`        | Ancestor chain for breadcrumbs     |
| POST   | `/api/allocate`               | Save user's allocations (batch)    |
| GET    | `/api/stats`                  | Participation statistics           |
| GET    | `/api/me`                     | Current auth status                |
| POST   | `/login`                      | Log in                             |
| POST   | `/logout`                     | Log out                            |

## Proportional Adjustment Formula

When slice *i* changes to V<sub>i,new</sub>:

```
Δ = V_i,new − V_i,old
V_j,new = V_j,old − (Δ × V_j,old / (100 − V_i,old))
```

This ensures every sibling group always sums to exactly 100%.
