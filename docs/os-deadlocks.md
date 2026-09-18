# Deadlocks in Operating Systems

A deadlock is a standoff. Two or more processes each hold a resource the other
needs, and none of them can move forward, so all of them wait forever. The
classic picture is two processes that each grabbed one of two locks and now want
the other one.

## The four Coffman conditions

A deadlock can only happen when all four of these hold at the same time:

1. **Mutual exclusion** — at least one resource is held in a non-shareable way.
   Only one process can use a printer or hold a write lock at a time.
2. **Hold and wait** — a process that already holds something is allowed to sit
   and wait for something else, without giving up what it has.
3. **No preemption** — the system cannot forcibly take a resource back. It is
   released only when its holder chooses to release it.
4. **Circular wait** — there is a cycle of processes where each one waits on a
   resource held by the next, and the last waits on the first.

Break any single condition and deadlock becomes impossible. That is the whole
basis of prevention.

## Prevention versus avoidance

**Prevention** attacks the conditions structurally. You might require a process
to request every resource it will need up front (killing hold-and-wait), or
number all resources and force requests in increasing order (killing circular
wait). Both work, and both waste resources, because processes end up holding
things long before they use them.

**Avoidance** is less blunt. The system allows the conditions to exist but
inspects each request before granting it, and refuses any request that could
lead to a state with no safe finishing order. This needs advance knowledge of
each process's maximum demand.

## Banker's algorithm

Dijkstra's banker's algorithm is the standard avoidance method. Each process
declares its maximum claim in advance. When a request arrives, the system
pretends to grant it and then asks: does some ordering of the remaining
processes exist in which each one can still get its maximum and finish? If yes,
the state is safe and the request is granted. If not, the requester waits. The
name comes from a banker who only lends when every client can still be paid out.

Many real systems skip all of this and simply detect deadlocks after the fact,
then kill or restart a victim process.
