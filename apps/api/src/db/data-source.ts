import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { Foundation1790035200000 } from './migrations/1790035200000-foundation';
import { Media1790035201000 } from './migrations/1790035201000-media';
import { Learning1790121600000 } from './migrations/1790121600000-learning';
import { Feedback1790200000000 } from './migrations/1790200000000-feedback';
import { CourseTags1790300000000 } from './migrations/1790300000000-course-tags';
import { CourseSchedules1790400000000 } from './migrations/1790400000000-course-schedules';
import { Enhancements1790500000000 } from './migrations/1790500000000-enhancements';
import { ScheduleRangeReason1790600000000 } from './migrations/1790600000000-schedule-range-reason';
import { ChapterQuizzesAndTypes1790700000000 } from './migrations/1790700000000-chapter-quizzes-and-types';
import { SubmissionGrading1790800000000 } from './migrations/1790800000000-submission-grading';
import { CourseComplaints1790900000000 } from './migrations/1790900000000-course-complaints';
import { LockedCoursesAndQuizTimeLimit1791000000000 } from './migrations/1791000000000-locked-courses-and-quiz-time-limit';
import { CourseVisibilityAndAccessMode1791100000000 } from './migrations/1791100000000-course-visibility-and-access-mode';

export function createDataSource(url: string): DataSource {
  return new DataSource({
    type: 'postgres', url, synchronize: false, logging: false,
    migrations: [
      Foundation1790035200000,
      Media1790035201000,
      Learning1790121600000,
      Feedback1790200000000,
      CourseTags1790300000000,
      CourseSchedules1790400000000,
      Enhancements1790500000000,
      ScheduleRangeReason1790600000000,
      ChapterQuizzesAndTypes1790700000000,
      SubmissionGrading1790800000000,
      CourseComplaints1790900000000,
      LockedCoursesAndQuizTimeLimit1791000000000,
      CourseVisibilityAndAccessMode1791100000000,
    ], migrationsTransactionMode: 'all',
    extra: { max: 10, connectionTimeoutMillis: 5000, statement_timeout: 10000 },
  });
}
