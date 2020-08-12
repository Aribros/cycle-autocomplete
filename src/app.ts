import xs, {Stream} from 'xstream'
import debounce from 'xstream/extra/debounce'
import dropUntil from 'xstream/extra/dropUntil'
import {ul, li, span, input, div, section, label,  button, a} from '@cycle/dom'
import  { Map} from 'immutable'
import {ResponseStream} from '@cycle/jsonp'
import {Sinks} from '@cycle/run'

const containerStyle = {
  background: '#EFEFEF',
  padding: '5px',
  textAlign: 'left',
}

const sectionStyle = {
  marginBottom: '10px',
}


const searchLabelStyle = {
  display: 'inline-block',
  width: '100px',
  textAlign: 'left',
  float: 'left'
}

const comboBoxStyle = {
  position: 'relative',
  marginTo: '100px',
  display: 'inline-block',
  width: '300px',
}

const inputTextStyle = {
  padding: '5px',
  width: '300px',
  boxSizing: 'border-box',
}

const autocompleteableStyle = Object.assign({}, inputTextStyle, {
  width: '100%',
  boxSizing: 'border-box',
})

const autocompleteMenuStyle = {
  position: 'absolute',
  left: '0px',
  right: '0px',
  top: '35px',
  zIndex: '999',
  listStyle: 'none',
  backgroundColor: 'white',
  margin: '0',
  padding: '0',
  borderTop: '1px solid #ccc',
  borderLeft: '1px solid #ccc',
  borderRight: '1px solid #ccc',
  boxSizing: 'border-box',
  boxShadow: '0px 4px 4px rgb(220,220,220)',
  userSelect: 'none',
  '-moz-box-sizing': 'border-box',
  '-webkit-box-sizing': 'border-box',
  '-webkit-user-select': 'none',
  '-moz-user-select': 'none',
}

const autocompleteItemStyle = {
  cursor: 'pointer',
  listStyle: 'none',
  padding: '3px 0 3px 8px',
  margin: '0',
  borderBottom: '1px solid #ccc',
}

const selectedListContainerStyle ={
  marginLeft: '60px'
}

const LIGHT_GREEN = '#8FE8B4'

//Model for state
interface StateModel {
  suggestions: Array<string>, 
  highlighted: number, 
  selected: string, 
  selectedList: Array<string>, 
  kyeToDelete: number
}

/**
 * source: --a--b----c----d---e-f--g----h---i--j-----
 * first:  -------F------------------F---------------
 * second: -----------------S-----------------S------
 *                         between
 * output: ----------c----d-------------h---i--------
 */
function between(first: Stream<any>, second: Stream<any>) {
  return (source) => first.mapTo(source.endWhen(second)).flatten()
}

/**
 * source: --a--b----c----d---e-f--g----h---i--j-----
 * first:  -------F------------------F---------------
 * second: -----------------S-----------------S------
 *                       notBetween
 * output: --a--b-------------e-f--g-----------j-----
 */
function notBetween(first: Stream<any>, second: Stream<any>) {
  return (source: Stream<any>) => xs.merge(
    source.endWhen(first),
    first.map(() => source.compose(dropUntil(second))).flatten()
  )
}

//Model Intent
function intent(domSource: any, timeSource: any) {
  const UP_KEYCODE = 38
  const DOWN_KEYCODE = 40
  const ENTER_KEYCODE = 13
  const TAB_KEYCODE = 9

  const input$ = domSource.select('.autocompleteable').events('input')
  const keydown$ = domSource.select('.autocompleteable').events('keydown')
  const itemHover$ = domSource.select('.autocomplete-item').events('mouseenter')
  const itemMouseDown$ = domSource.select('.autocomplete-item').events('mousedown')
  const itemMouseUp$ = domSource.select('.autocomplete-item').events('mouseup')
  const inputFocus$ = domSource.select('.autocompleteable').events('focus')
  const inputBlur$ = domSource.select('.autocompleteable').events('blur')

  const btnDelete$ = domSource.select('.btn-delete').events('click')

  const enterPressed$ = keydown$.filter(({keyCode}) => keyCode === ENTER_KEYCODE)
  const tabPressed$ = keydown$.filter(({keyCode}) => keyCode === TAB_KEYCODE)
  const clearField$ = input$.filter(ev => ev.target.value.length === 0)
  const inputBlurToItem$ = inputBlur$.compose(between(itemMouseDown$, itemMouseUp$))
  const inputBlurToElsewhere$ = inputBlur$.compose(notBetween(itemMouseDown$, itemMouseUp$))
  const itemMouseClick$ = itemMouseDown$
    .map(down => itemMouseUp$.filter(up => down.target === up.target))
    .flatten()

  return {
    search$: input$
      .compose(timeSource.debounce(500))
      .compose(between(inputFocus$, inputBlur$))
      .map((ev) => ev.target.value)
      .filter(query => query.length > 0),
    moveHighlight$: keydown$
      .map(({keyCode}) => { switch (keyCode) {
        case UP_KEYCODE: return -1
        case DOWN_KEYCODE: return +1
        default: return 0
      }})
      .filter(delta => delta !== 0),
    setHighlight$: itemHover$
      .map(ev => parseInt(ev.target.dataset.index)),
    keepFocusOnInput$:
      xs.merge(inputBlurToItem$, enterPressed$, tabPressed$),
    selectHighlighted$:
      xs.merge(itemMouseClick$, enterPressed$, tabPressed$).compose(debounce(1)),
    wantsSuggestions$:
      xs.merge(inputFocus$.mapTo(true), inputBlur$.mapTo(false)),
    quitAutocomplete$:
      xs.merge(clearField$, inputBlurToElsewhere$),
    wantDeleted$: btnDelete$,
  }
}

//Reducers
function reducers(actions: any) {
  //Move by keyboard
  const moveHighlightReducer$ = actions.moveHighlight$
    .map((delta: number) => function moveHighlightReducer(state: Map<string, any>) {
      const suggestions = state.get('suggestions')
      const wrapAround = (x: number) => (x + suggestions.length) % suggestions.length
      return state.update('highlighted', (highlighted: number) => {
        if (highlighted === null) {
          return wrapAround(Math.min(delta, 0))
        } else {
          return wrapAround(highlighted + delta)
        }
      })
    })

  //highlight by mouse movement
  const setHighlightReducer$ = actions.setHighlight$
    .map((highlighted: number) => function setHighlightReducer(state: Map<string, any>) {
      return state.set('highlighted', highlighted)
    })

  //select when clicked and update state
  const selectHighlightedReducer$ = actions.selectHighlighted$
    .mapTo(xs.of(true, false))
    .flatten()
    .map((selected: Boolean) => function selectHighlightedReducer(state: Map<string, any>) {
      const suggestions = state.get('suggestions')
      const highlighted = state.get('highlighted')

      const hasHighlight = highlighted !== null
      const isMenuEmpty = suggestions.length === 0

      if (selected && hasHighlight && !isMenuEmpty) {
          
        return state
          .set('selected', suggestions[highlighted])
          .set('suggestions', [])   
      } else {
        return state.set('selected', null).set('clearText', false)
      }
    })

  //Hide auto complete menu
  const hideReducer$ = actions.quitAutocomplete$
    .mapTo(function hideReducer(state: Map<string, any>) {
      return state.set('suggestions', [])
    })

    //Select ID to delete
  const wantDeleteReducer$ = actions.wantDeleted$
    .map((e: any) => function wantDeleteReducer(state: Map<string, any>) {
      let kyeToDelete = e.target.value
      return kyeToDelete !== null ? state.set('kyeToDelete', kyeToDelete) : state
    })


  return xs.merge(
    moveHighlightReducer$,
    setHighlightReducer$,
    selectHighlightedReducer$,
    hideReducer$,
    wantDeleteReducer$ ,
  )
}


//Data Model
function model(suggestionsFromResponse$ : Stream<any>, actions : any) {
  const reducer$ = reducers(actions)
  //Suggestions stream
  const suggestion$ = actions.wantsSuggestions$
    .map((accepted: Boolean) =>
      suggestionsFromResponse$.map(suggestions => accepted ? suggestions : [])
    )
    .flatten()
    .startWith([])
    .map((suggestions: Array<string>) => {
      const model: StateModel = {
        suggestions,
        highlighted: null,
        selected: null,
        selectedList: [],
        kyeToDelete: null
      }
      return Map(model)
    })
    .map((state: Stream<any>) => reducer$.fold((acc :Stream<any>, reducer: Function) => reducer(acc), state) )
    .flatten()
  
  //Fold Selected int array
  const list$ = suggestion$ 
    .fold((prevState: Array<String>, newState: Map<String, any>) => {
      //Process delete
      let kyeToDelete = newState.get('kyeToDelete')
      if(kyeToDelete && prevState && prevState.length > 0){
        prevState.splice(kyeToDelete, 1)
      }
      //process selected
      let selected: String = newState.get('selected')
      if(selected != null){
        prevState = [...prevState, selected]
      }
      
      return prevState
    }, [])

  const state$ = xs.combine(suggestion$, list$)
    .map(([state, list] : Array<any>)  => {
      return state.set('selectedList', list)
    })

  return state$
}


//Render auto complete menu
function renderAutocompleteMenu({suggestions, highlighted}) {
  if (suggestions.length === 0) { return ul() }
  const childStyle = (index: number) => (Object.assign({}, autocompleteItemStyle, {
    backgroundColor: highlighted === index ? LIGHT_GREEN : null
  }))

  return ul('.autocomplete-menu', {style: autocompleteMenuStyle},
    suggestions.map((suggestion: string, index: number) =>
      li('.autocomplete-item',
        {style: childStyle(index), attrs: {'data-index': index}},
        suggestion
      )
    )
  )
}


//Render combo box
function renderComboBox({suggestions, highlighted, selected}) {
  return span('.combo-box', {style: comboBoxStyle}, [
    input('.autocompleteable form-control', {
      style: autocompleteableStyle,
      attrs: {type: 'text'},
      hook: {
        update: (old: any, {elm}) => {
          if (selected !== null) {
            elm.value = selected
          }
        }
      }
    }),
    renderAutocompleteMenu({suggestions, highlighted})
  ])
}


//Render Selected List from autocomplete menu
function renderList({selectedList}){
  if(selectedList==undefined|| selectedList.length === 0){
    return null;
  }

 return ul('.list-container',{style:selectedListContainerStyle},
    selectedList.map((val:String, key:number)=> {
      return li('.list-item badge  badge-dark pr-0 mr-1 pl-2 py-0',[
        span(val + ' -  '),
        button('.btn-delete btn-secondary btn btn-secondary py-0 px-1 my-0', {attrs: {type: 'button', value: key}}, 'Delete')
      ])
 }))
}

//Main DOM View
function view(state$: Stream<any>) {
  return state$.map(state => {
    const suggestions = state.get('suggestions')
    const highlighted = state.get('highlighted')
    const selected = state.get('selected')
    const selectedList = state.get('selectedList')

    return (
      div('.container jumbotron jumbotron-fluid', {style: containerStyle}, [
        section('.container',{style: sectionStyle}, [
          label('.search-label left', {style: searchLabelStyle}, 'Query:'),
          renderComboBox({suggestions, highlighted, selected}),
          renderList({selectedList}),
        ]),
        section('.container',{style: sectionStyle}, [
          label('.left',{style: searchLabelStyle}, 'Some field:'),
          input('.form-control left',{style: inputTextStyle, attrs: {type: 'text'}})
        ])
      ])
    )
  })
}

//URL for auto complete
const BASE_URL =
  'https://en.wikipedia.org/w/api.php?action=opensearch&format=json&search='

// Process network request
const networking = {
  processResponses(JSONP: ResponseStream) {
    return JSONP.filter(res$ => res$.request.indexOf(BASE_URL) === 0)
      .flatten()
      .map((res: any) => res[1])
  },

  generateRequests(searchQuery$: Stream<any>) {
    return searchQuery$.map(q => BASE_URL + encodeURI(q))
  },
}

//Prevent Default Events
function preventedEvents(actions: any, state$: Stream<any> ) {
  return state$
    .map(state =>
      actions.keepFocusOnInput$.map(event => {
        if (state.get('suggestions').length > 0 
        && state.get('highlighted') !== null) {
          return event
        } else {
          return null
        }
      })
    )
    .flatten()
    .filter((ev: any) => ev !== null)
}

//Main APP
export default function app(sources: any) : Sinks<any> {
  const suggestionsFromResponse$ = networking.processResponses(sources.JSONP)
  const actions = intent(sources.DOM, sources.Time)
  const state$ = model(suggestionsFromResponse$, actions)
 
  const vtree$ = view(state$)
  const prevented$ = preventedEvents(actions, state$)
  const searchRequest$ = networking.generateRequests(actions.search$)
  
  return {
    DOM: vtree$,
    preventDefault: prevented$,
    JSONP: searchRequest$,
  }
}


// https://egghead.io/lessons/rxjs-fetch-data-using-the-cycle-js-http-driver