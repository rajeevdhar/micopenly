Rails.application.routes.draw do

  resources :articles
    resources :comments

  get 'welcome/index'

  root 'welcome#index'

end