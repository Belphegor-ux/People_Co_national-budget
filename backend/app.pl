use Mojolicious::Lite -signatures;
use Mojo::Pg;

# ── Configuration ──────────────────────────────────────────────
app->secrets(['budget-app-secret-change-me']);
app->sessions->default_expiration(86400); # 24 hours

# ── Database connection (via Docker env) ───────────────────────
helper pg => sub { state $pg = Mojo::Pg->new($ENV{DATABASE_URL}) };

# ── Serve static files from /public ────────────────────────────
app->static->paths->[0] = app->home->child('public');

# ── Routes ─────────────────────────────────────────────────────

# Main page
get '/' => sub ($c) {
    $c->render(template => 'index');
};

# API: Get children of a tree node
#   ?mode=view  → collective average allocations (default)
#   ?mode=edit  → personal allocations for logged-in user
get '/api/tree/:parent_id' => sub ($c) {
    my $parent_id = $c->param('parent_id');
    my $user_id   = $c->session('user_id');
    my $mode      = $c->param('mode') || 'view';

    my $results;

    if ($mode eq 'edit' && $user_id) {
        # Personal allocations; default to equal split if none saved
        my $sql = q{
            WITH sibling_count AS (
                SELECT COUNT(*) AS cnt FROM org_tree WHERE parent_dept_id = ?
            )
            SELECT o.dept_id    AS id,
                   o.parent_dept_id AS parent_id,
                   o.dept_name  AS name,
                   o.description,
                   o.depth,
                   COALESCE(u.allocation, ROUND(100.0 / sc.cnt, 2)) AS budget_allocation
            FROM org_tree o
            CROSS JOIN sibling_count sc
            LEFT JOIN user_allocation u
                   ON o.dept_id = u.dept_id AND u.user_id = ?
            WHERE o.parent_dept_id = ?
            ORDER BY o.dept_id
        };
        $results = $c->pg->db->query($sql, $parent_id, $user_id, $parent_id)->hashes;
    } else {
        # Collective average allocations
        my $sql = q{
            WITH sibling_count AS (
                SELECT COUNT(*) AS cnt FROM org_tree WHERE parent_dept_id = ?
            )
            SELECT o.dept_id    AS id,
                   o.parent_dept_id AS parent_id,
                   o.dept_name  AS name,
                   o.description,
                   o.depth,
                   COALESCE(
                       AVG(u.allocation),
                       ROUND(100.0 / sc.cnt, 2)
                   ) AS budget_allocation
            FROM org_tree o
            CROSS JOIN sibling_count sc
            LEFT JOIN user_allocation u ON o.dept_id = u.dept_id
            WHERE o.parent_dept_id = ?
            GROUP BY o.dept_id, o.parent_dept_id, o.dept_name,
                     o.description, o.depth, sc.cnt
            ORDER BY o.dept_id
        };
        $results = $c->pg->db->query($sql, $parent_id, $parent_id)->hashes;
    }

    $c->render(json => $results);
};

# API: Check if a node has children (for drill-down UI cues)
get '/api/tree/:parent_id/has_children' => sub ($c) {
    my $parent_id = $c->param('parent_id');
    my $count = $c->pg->db->query(
        'SELECT COUNT(*) AS cnt FROM org_tree WHERE parent_dept_id = ?',
        $parent_id
    )->hash->{cnt};
    $c->render(json => { has_children => ($count > 0 ? \1 : \0) });
};

# API: Get node info (for breadcrumb trail)
get '/api/node/:id' => sub ($c) {
    my $id = $c->param('id');
    my $node = $c->pg->db->query(
        'SELECT dept_id AS id, parent_dept_id AS parent_id, dept_name AS name, depth
         FROM org_tree WHERE dept_id = ?', $id
    )->hash;
    $c->render(json => $node);
};

# API: Get ancestor chain for breadcrumbs
get '/api/breadcrumbs/:id' => sub ($c) {
    my $id = $c->param('id');
    my $sql = q{
        WITH RECURSIVE ancestors AS (
            SELECT dept_id, parent_dept_id, dept_name, depth
            FROM org_tree WHERE dept_id = ?
            UNION ALL
            SELECT o.dept_id, o.parent_dept_id, o.dept_name, o.depth
            FROM org_tree o
            INNER JOIN ancestors a ON o.dept_id = a.parent_dept_id
        )
        SELECT dept_id AS id, parent_dept_id AS parent_id, dept_name AS name, depth
        FROM ancestors
        ORDER BY depth ASC
    };
    my $results = $c->pg->db->query($sql, $id)->hashes;
    $c->render(json => $results);
};

# API: Save user allocations (batch)
post '/api/allocate' => sub ($c) {
    my $payload = $c->req->json;
    my $user_id = $c->session('user_id');

    return $c->render(json => {error => 'Unauthorized'}, status => 401)
        unless $user_id;

    # Validate: allocations must sum to ~100
    my $total = 0;
    $total += $_->{budget_allocation} for @$payload;
    if (abs($total - 100) > 0.5) {
        return $c->render(
            json   => {error => "Allocations must sum to 100 (got $total)"},
            status => 400
        );
    }

    my $db = $c->pg->db;
    my $tx = $db->begin;

    for my $node (@$payload) {
        $db->query(
            'INSERT INTO user_allocation (dept_id, user_id, allocation)
             VALUES (?, ?, ?)
             ON CONFLICT (dept_id, user_id)
             DO UPDATE SET allocation = EXCLUDED.allocation, updated_at = NOW()',
            $node->{id}, $user_id, $node->{budget_allocation}
        );
    }

    $tx->commit;
    $c->render(json => {status => 'success'});
};

# API: Get participation stats
get '/api/stats' => sub ($c) {
    my $stats = $c->pg->db->query(q{
        SELECT
            COUNT(DISTINCT user_id) AS total_participants,
            COUNT(*)                AS total_votes,
            MAX(updated_at)         AS last_activity
        FROM user_allocation
    })->hash;
    $c->render(json => $stats);
};

# ── Auth (simplified for demo) ─────────────────────────────────
post '/login' => sub ($c) {
    my $data = $c->req->json;
    my $user = $c->pg->db->query(
        'SELECT user_id FROM users WHERE username = ? AND password = ?',
        $data->{username}, $data->{password}
    )->hash;

    if ($user) {
        $c->session(user_id  => $user->{user_id});
        $c->render(json => {status => 'success', user_id => $user->{user_id}});
    } else {
        $c->render(json => {error => 'Invalid credentials'}, status => 401);
    }
};

post '/logout' => sub ($c) {
    $c->session(expires => 1);
    $c->render(json => {status => 'logged_out'});
};

get '/api/me' => sub ($c) {
    my $uid = $c->session('user_id');
    if ($uid) {
        my $user = $c->pg->db->query(
            'SELECT user_id, username FROM users WHERE user_id = ?', $uid
        )->hash;
        $c->render(json => {logged_in => \1, %$user});
    } else {
        $c->render(json => {logged_in => \0});
    }
};

app->start;
