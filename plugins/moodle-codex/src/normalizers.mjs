import { cleanUrl, REQUIRED_FUNCTIONS, stripHtml } from "./moodle-client.mjs";

export function siteInfoResult(site) {
  const available = (site.functions ?? []).map((item) => item.name).filter(Boolean);
  return {
    site: {
      sitename: site.sitename,
      siteurl: cleanUrl(site.siteurl),
      username: site.username,
      fullname: site.fullname,
      userid: site.userid,
      lang: site.lang,
      release: site.release,
      version: site.version,
    },
    available_functions: available,
    missing_required_functions: available.length
      ? REQUIRED_FUNCTIONS.filter((name) => !available.includes(name))
      : [],
  };
}

export function coursesResult(courses) {
  return {
    courses: courses.map((course) => ({
      id: course.id,
      shortname: course.shortname,
      fullname: course.fullname,
      displayname: course.displayname,
      summary: stripHtml(course.summary, 1_500),
      startdate: course.startdate,
      enddate: course.enddate,
      visible: course.visible,
      progress: course.progress,
      viewurl: cleanUrl(course.viewurl),
    })),
  };
}

function contentFile(file) {
  return {
    filename: file.filename,
    filepath: file.filepath,
    filesize: file.filesize,
    fileurl: cleanUrl(file.fileurl),
    mimetype: file.mimetype,
    timecreated: file.timecreated,
    timemodified: file.timemodified,
  };
}

function textField(name, value, limit, fullText) {
  const text = stripHtml(value, Infinity);
  return { [name]: fullText ? text : text.slice(0, limit), [name + "_truncated"]: !fullText && text.length > limit, [name + "_length"]: text.length };
}

export function courseContentsResult(sections, fullText = false) {
  return {
    sections: sections.map((section) => ({
      id: section.id,
      name: section.name,
      section: section.section,
      ...textField("summary", section.summary, 2000, fullText),
      visible: section.visible,
      modules: (section.modules ?? []).map((module) => ({
        id: module.id,
        name: module.name,
        modname: module.modname,
        ...textField("description", module.description, 2000, fullText),
        url: cleanUrl(module.url),
        visible: module.visible,
        ...textField("availabilityinfo", module.availabilityinfo, 1000, fullText),
        completiondata: module.completiondata,
        dates: module.dates,
        contents: (module.contents ?? []).map(contentFile),
      })),
    })),
  };
}

export function assignmentsResult(payload, fullText = false) {
  return {
    courses: (payload.courses ?? []).map((course) => ({
      id: course.id,
      shortname: course.shortname,
      fullname: course.fullname,
      assignments: (course.assignments ?? []).map((assignment) => ({
        id: assignment.id,
        cmid: assignment.cmid,
        name: assignment.name,
        ...textField("intro", assignment.intro, 2000, fullText),
        allowsubmissionsfromdate: assignment.allowsubmissionsfromdate,
        duedate: assignment.duedate,
        cutoffdate: assignment.cutoffdate,
        gradingduedate: assignment.gradingduedate,
        timemodified: assignment.timemodified,
        introattachments: (assignment.introattachments ?? []).map(contentFile),
        introfiles: (assignment.introfiles ?? []).map(contentFile),
        nosubmissions: assignment.nosubmissions,
        submissionsenabled: assignment.submissionsenabled,
      })),
    })),
    warnings: payload.warnings ?? [],
  };
}

export function deadlinesResult(payload) {
  return {
    firstid: payload.firstid ?? null,
    lastid: payload.lastid ?? null,
    events: (payload.events ?? []).map((event) => ({
      id: event.id,
      name: event.name,
      description: stripHtml(event.description, 2_000),
      eventtype: event.eventtype,
      timestart: event.timestart,
      timesort: event.timesort,
      url: cleanUrl(event.url),
      course: event.course
        ? {
            id: event.course.id,
            shortname: event.course.shortname,
            fullname: event.course.fullname,
          }
        : undefined,
      action: event.action
        ? {
            name: event.action.name,
            url: cleanUrl(event.action.url),
            itemcount: event.action.itemcount,
            actionable: event.action.actionable,
          }
        : undefined,
    })),
    warnings: payload.warnings ?? [],
  };
}
