# Database Normalization

Normalization is the process of arranging columns and tables so that each fact
is stored exactly once. When a fact lives in one place, there is no way for two
copies of it to disagree, and no way for deleting one row to quietly destroy
unrelated information.

Consider a badly designed table:

`Enrollment(student_id, student_name, course_id, course_name, instructor, phones)`

## First normal form (1NF)

Every column holds a single atomic value, and there are no repeating groups. The
`phones` column above, stuffed with `"555-1234, 555-9876"`, breaks 1NF. Move
phone numbers into their own `StudentPhone(student_id, phone)` table.

## Second normal form (2NF)

In 1NF, plus no non-key column depends on only part of a composite key. Our key
is `(student_id, course_id)`. But `student_name` depends on `student_id` alone
and `course_name` depends on `course_id` alone, so both are partial
dependencies. Split them out into `Student(student_id, student_name)` and
`Course(course_id, course_name, instructor)`, leaving
`Enrollment(student_id, course_id)`.

## Third normal form (3NF)

In 2NF, plus no non-key column depends on another non-key column. Suppose
`Course` also carried `instructor_office`. Office depends on `instructor`, which
is not a key, so it is a transitive dependency. Move it to
`Instructor(instructor, office)`.

## Boyce-Codd normal form (BCNF)

A stricter 3NF: for every dependency X → Y, X must be a candidate key. The usual
counterexample is a table `(student, subject, tutor)` where each tutor teaches
exactly one subject and a student has one tutor per subject. The dependency
`tutor → subject` holds, but `tutor` is not a candidate key, so the table is 3NF
yet not BCNF. Splitting it into `(tutor, subject)` and `(student, tutor)` fixes
the anomaly.

Higher forms exist (4NF, 5NF), but most working schemas stop at 3NF or BCNF.
Deliberate denormalization is then a read-performance decision, made knowing
which duplicated facts you now have to keep in sync.
